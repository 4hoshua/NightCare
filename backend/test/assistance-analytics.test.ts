import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { buildApp } from "../src/app.js";

const id = "nightcare-001",
  other = "nightcare-002",
  root = "nightcare/assistance/";
const now = Date.parse("2026-11-13T15:00:00Z"),
  day = 86400000;
function device(s: Store, deviceId = id) {
  s.db.prepare("INSERT INTO devices(device_id) VALUES (?)").run(deviceId);
}
function request(
  s: Store,
  key: string,
  at: number,
  status = "CLOSED",
  deviceId = id,
) {
  s.db
    .prepare(
      "INSERT INTO assistance_requests(device_id,request_id,status,press_count,updated_at,opened_at) VALUES (?,?,?,5,?,?)",
    )
    .run(deviceId, key, status, now, at);
}
function command(
  s: Store,
  key: string,
  at: number,
  status = "APPLIED",
  deviceId = id,
) {
  s.db
    .prepare(
      "INSERT INTO commands(device_id,command_id,request_id,action,payload,status,created_at,expires_at) VALUES (?,?,?,'ACK_HELP','{}',?,?,?)",
    )
    .run(deviceId, key, "call", status, at, at + 60000);
}
function event(
  s: Store,
  key: string,
  at: number,
  type = "HELP_OPENED",
  deviceId = id,
  requestId = key,
) {
  // Timestamp firmware propositalmente fora da janela; importa o recebimento.
  s.db
    .prepare(
      "INSERT OR IGNORE INTO events(device_id,event_id,type,request_id,occurred_at,received_at,payload) VALUES (?,?,?,?,'2020-01-01T00:00:00Z',?,'{}')",
    )
    .run(deviceId, key, type, requestId, at);
}
test("assistance aggregates complete history across closed calls and isolates devices", () => {
  const s = new Store(":memory:", () => now, root);
  try {
    device(s);
    device(s, other);
    for (let n = 0; n < 135; ++n) {
      request(s, "call-" + n, now - 60000);
      event(s, "call-" + n, now - 60000);
      command(s, "cmd-" + n, now - 60000);
    }
    request(s, "pending", now - 20000, "PENDING");
    request(s, "recognized", now - 10000, "ACKNOWLEDGED");
    request(s, "other", now - 60000, "CLOSED", other);
    event(s, "other", now - 60000, "HELP_OPENED", other);
    command(s, "other", now - 60000, "REJECTED", other);
    event(s, "call-0", now - 60000); // redelivery idempotente.
    event(s, "repeat", now - 1000, "HELP_REITERATED", id, "old-call");
    event(s, "recover", now - 1000, "HELP_RECOVERED");
    event(s, "ack", now - 1000, "HELP_ACKNOWLEDGED");
    event(s, "close", now - 1000, "HELP_CLOSED");
    command(s, "rejected", now - 9000, "REJECTED");
    command(s, "pending", now - 9999, "PENDING");
    command(s, "timeout", now - 10000, "PENDING");
    command(s, "unconfirmed", now - 20000, "UNCONFIRMED");
    const a = s.assistanceAnalytics(id, "24h");
    assert.equal(
      a.callActivity.reduce((sum, p) => sum + p.count, 0),
      a.requests.total,
    );
    assert.equal(a.timezoneOffsetHours, -3);
    assert.deepEqual(a.requests, {
      total: 137,
      pending: 1,
      acknowledged: 1,
      closed: 135,
    });
    assert.deepEqual(a.presses, { total: 136, initial: 135, reiterations: 1 });
    assert.deepEqual(a.commands, {
      total: 139,
      applied: 135,
      rejected: 1,
      pending: 1,
      unconfirmed: 2,
    });
    assert.equal(s.snapshot(id).commands.length, 30);
    assert.equal(s.snapshot(id).requests.length, 100);
    const b = s.assistanceAnalytics(other, "24h");
    assert.equal(b.requests.total, 1);
    assert.equal(b.presses.total, 1);
    assert.equal(b.commands.rejected, 1);
  } finally {
    s.close();
  }
});
test("assistance windows are rolling and receipt-based, including exact start and excluding end", () => {
  const s = new Store(":memory:", () => now, root);
  try {
    device(s);
    for (const [n, at] of [
      now - day - 1,
      now - day,
      now - 1,
      now,
      now + 1,
    ].entries()) {
      request(s, String(n), at);
      event(s, String(n), at);
      command(s, String(n), at);
    }
    request(s, "old", now - 31 * day, "PENDING");
    event(s, "old-repeat", now - 500, "HELP_REITERATED", id, "old");
    const a = s.assistanceAnalytics(id, "24h");
    assert.equal(a.from, now - day);
    assert.equal(a.to, now);
    assert.equal(a.requests.total, 2);
    assert.equal(a.presses.total, 3);
    assert.equal(a.commands.total, 2);
    assert.equal(s.assistanceAnalytics(id, "7d").requests.total, 3);
    assert.equal(s.assistanceAnalytics(id, "30d").requests.total, 3);
    assert.equal(s.assistanceAnalytics(id, "30d").from, now - 30 * day);
  } finally {
    s.close();
  }
});
test("late command ACK updates analytics after timeout and closed calls retain their history", async () => {
  let clock = now - 20000;
  const s = new Store(":memory:", () => clock, root);
  const ingest = (topic: string, p: object) =>
    s.ingest(root + id + "/" + topic, Buffer.from(JSON.stringify(p)), false);
  const help = {
    schemaVersion: 1,
    deviceId: id,
    bootId: "boot",
    uptimeMs: 10,
    requestId: "call",
    occurredAt: null,
    pressCount: 1,
  };
  try {
    ingest("events", { ...help, eventId: "open", type: "HELP_OPENED" });
    ingest("events", { ...help, eventId: "open", type: "HELP_OPENED" });
    command(s, "late", clock, "PENDING");
    clock = now;
    assert.equal(s.assistanceAnalytics(id, "24h").commands.unconfirmed, 1);
    ingest("acks", {
      schemaVersion: 1,
      deviceId: id,
      commandId: "late",
      requestId: "call",
      status: "APPLIED",
      reason: "OK",
    });
    ingest("events", { ...help, eventId: "closed", type: "HELP_CLOSED" });
    const a = s.assistanceAnalytics(id, "24h");
    assert.equal(a.requests.closed, 1);
    assert.equal(a.presses.initial, 1);
    assert.equal(a.commands.applied, 1);
    assert.equal(a.commands.unconfirmed, 0);
  } finally {
    s.close();
  }
});
test("call activity pads zeros and covers hourly/daily windows with exact partial boundaries", () => {
  const clock = now + 37 * 60000;
  const s = new Store(":memory:", () => clock, root);
  try {
    device(s);
    for (const period of ["24h", "7d", "30d"] as const) {
      const empty = s.assistanceAnalytics(id, period);
      const points = empty.callActivity;
      assert.equal(
        points.length,
        period === "24h" ? 25 : period === "7d" ? 8 : 31,
      );
      assert.equal(points[0].start, empty.from);
      assert.equal(points.at(-1)!.end, clock);
      assert.ok(points[0].partial && points.at(-1)!.partial);
      assert.ok(points.every((p) => p.count === 0 && p.end > p.start));
      for (let n = 1; n < points.length; ++n)
        assert.equal(points[n].start, points[n - 1].end);
      assert.equal(
        points.reduce((sum, p) => sum + p.end - p.start, 0),
        clock - empty.from,
      );
    }
    const initial = s.assistanceAnalytics(id, "24h");
    const split = initial.callActivity[1].start;
    request(s, "before-window", initial.from - 1);
    request(s, "start", initial.from);
    request(s, "before-split", split - 1);
    request(s, "at-split", split);
    request(s, "last", clock - 1);
    request(s, "outside", clock);
    const actual = s.assistanceAnalytics(id, "24h");
    assert.equal(actual.callActivity[0].count, 2);
    assert.equal(actual.callActivity[1].count, 1);
    assert.equal(actual.callActivity.at(-1)!.count, 1);
    assert.equal(
      actual.callActivity.reduce((sum, p) => sum + p.count, 0),
      4,
    );
    assert.equal(actual.requests.total, 4);
  } finally {
    s.close();
  }
});

test("daily call activity uses effective offset for midnight and falls back without runtime telemetry", () => {
  const s = new Store(":memory:", () => now, root);
  try {
    device(s);
    const midnight = Date.parse("2026-11-13T10:00:00Z"); // UTC+14: 14/11 00h.
    request(s, "before-midnight", midnight - 1);
    request(s, "at-midnight", midnight);
    for (const offset of [-12, 14]) {
      s.db
        .prepare("UPDATE devices SET state=? WHERE device_id=?")
        .run(
          JSON.stringify({ runtimeSettings: { timezoneOffsetHours: offset } }),
          id,
        );
      const a = s.assistanceAnalytics(id, "7d");
      assert.equal(a.timezoneOffsetHours, offset);
      for (const p of a.callActivity.slice(1))
        assert.equal((p.start + offset * 3600000) % day, 0);
      assert.equal(
        a.callActivity.reduce((sum, p) => sum + p.count, 0),
        2,
      );
    }
    const a = s.assistanceAnalytics(id, "7d");
    assert.equal(a.callActivity.find((p) => p.start === midnight)!.count, 1);
    s.db
      .prepare("UPDATE devices SET state=? WHERE device_id=?")
      .run(JSON.stringify({ appliedConfigVersion: 1 }), id);
    assert.equal(s.assistanceAnalytics(id, "7d").timezoneOffsetHours, -3);
  } finally {
    s.close();
  }
});

test("activity counts first registration once, unaffected by reiteration and status updates", () => {
  let clock = now - 3600000;
  const s = new Store(":memory:", () => clock, root);
  const help = {
    schemaVersion: 1,
    deviceId: id,
    bootId: "boot",
    uptimeMs: 10,
    requestId: "call",
    occurredAt: null,
    pressCount: 1,
  };
  const ingest = (eventId: string, type: string) =>
    s.ingest(
      root + id + "/events",
      Buffer.from(JSON.stringify({ ...help, eventId, type })),
      false,
    );
  try {
    ingest("opened", "HELP_OPENED");
    ingest("opened", "HELP_OPENED");
    clock = now - 1;
    ingest("repeat", "HELP_REITERATED");
    ingest("closed", "HELP_CLOSED");
    clock = now;
    const a = s.assistanceAnalytics(id, "24h");
    assert.equal(a.requests.total, 1);
    assert.equal(a.requests.closed, 1);
    assert.equal(
      a.callActivity.reduce((sum, p) => sum + p.count, 0),
      1,
    );
    assert.equal(
      a.callActivity.find((p) => p.start === now - 3600000)!.count,
      1,
    );
    assert.equal(a.presses.total, 2);
  } finally {
    s.close();
  }
});

test("assistance history remains available after reopening SQLite without an active call", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "nightcare-assistance-analytics-"),
  );
  const path = join(directory, "history.sqlite");
  let s = new Store(path, () => now, root);
  try {
    device(s);
    request(s, "closed", now - 60000);
    event(s, "closed", now - 60000);
    command(s, "closed", now - 60000);
    const before = s.assistanceAnalytics(id, "24h");
    s.close();
    s = new Store(path, () => now, root);
    assert.deepEqual(s.assistanceAnalytics(id, "24h"), before);
    assert.equal(s.device(id).state, null);
    assert.equal(before.requests.closed, 1);
  } finally {
    s.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("assistance HTTP defaults, validates query/device and returns real zeros for an empty device", async () => {
  const s = new Store(":memory:", () => now, root);
  device(s);
  const app = await buildApp(s);
  try {
    const path = `/api/devices/${id}/assistance-analytics`;
    const response = await app.inject(path);
    assert.equal(response.statusCode, 200);
    const a = response.json();
    assert.equal(a.period, "24h");
    assert.equal(a.deviceId, id);
    assert.equal(a.requests.total, 0);
    assert.equal(a.presses.total, 0);
    assert.equal(a.commands.total, 0);
    for (const query of [
      "period=1d",
      "extra=yes",
      "period=7d&period=30d",
    ]) {
      assert.equal((await app.inject(path + "?" + query)).statusCode, 400);
    }
    assert.equal(
      (await app.inject(`/api/devices/${other}/assistance-analytics`))
        .statusCode,
      404,
    );
    assert.equal((await app.inject(path + "?period=7d")).json().period, "7d");
    assert.equal((await app.inject(path + "?period=30d")).json().period, "30d");
  } finally {
    await app.close();
    s.close();
  }
});
