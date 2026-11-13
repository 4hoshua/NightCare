import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { buildApp } from "../src/app.js";
const root = "nightcare/observability/",
  id = "nightcare-001",
  other = "nightcare-002",
  base = Date.parse("2026-11-13T12:00:00Z");
let sequence = 0;
function ingest(
  s: Store,
  suffix = "state",
  retained = false,
  deviceId = id,
  extra: Record<string, unknown> = {},
) {
  const payload =
    suffix === "state"
      ? {
          schemaVersion: 1,
          deviceId,
          bootId: "test",
          sequence: ++sequence,
          uptimeMs: 10,
          mode: "AUTO",
          brightnessPct: 30,
          lightOn: false,
          motion: false,
          assistanceStatus: "NONE",
          requestId: null,
          pressCount: 0,
          clockValid: true,
          appliedConfigVersion: 0,
          droppedEvents: 0,
          persistenceOk: true,
          ...extra,
        }
      : suffix === "events"
        ? {
            schemaVersion: 1,
            deviceId,
            bootId: "test",
            eventId: "duplicate",
            type: "MOTION_STARTED",
            occurredAt: null,
            uptimeMs: 10,
            requestId: null,
            ...extra,
          }
        : { schemaVersion: 1, deviceId, status: "offline", ...extra };
  s.ingest(
    root + deviceId + "/" + suffix,
    Buffer.from(JSON.stringify(payload)),
    retained,
  );
}
test("observations isolate devices, exclude retained/invalid input, count deliveries and expire presence exactly", () => {
  let now = base;
  const s = new Store(":memory:", () => now, root);
  try {
    s.brokerChanged(true);
    ingest(s, "state", true);
    ingest(s, "state", true, other);
    assert.throws(() => ingest(s, "state", false, id, { schemaVersion: 2 }));
    for (let i = 0; i < 5; i++) {
      now += 1000;
      s.tick();
    }
    ingest(s);
    ingest(s, "events");
    ingest(s, "events");
    for (let i = 0; i < 55; i++) {
      now += 1000;
      s.tick();
    }
    const a = s.observability.read(id),
      b = s.observability.read(other);
    assert.equal(a.messages, 3);
    assert.equal(s.history({}, id).length, 1);
    assert.equal(a.totals.onlineMs, 45000);
    assert.equal(a.totals.offlineMs, 10000);
    assert.equal(a.totals.unknownMs, 86400000 - 55000);
    assert.equal(b.messages, 0);
    assert.equal(b.totals.unknownMs, 86400000);
    assert.equal(a.lastContact, base + 5000);
    assert.equal(a.presence.length, 1440);
    assert.equal(a.hourly.length, 24);
  } finally {
    s.close();
  }
});
test("broker outages and scheduler stalls remain unknown; Last Will observes offline without restoring online on connect", () => {
  let now = base;
  const s = new Store(":memory:", () => now, root);
  try {
    s.brokerChanged(true);
    ingest(s);
    for (let i = 0; i < 10; i++) {
      now += 1000;
      s.tick();
    }
    s.markDisconnected();
    for (let i = 0; i < 10; i++) {
      now += 1000;
      s.tick();
    }
    s.brokerChanged(true);
    for (let i = 0; i < 10; i++) {
      now += 1000;
      s.tick();
    }
    ingest(s);
    now += 10000;
    s.tick(); // all ten seconds unknown, no extrapolation
    ingest(s, "availability");
    for (let i = 0; i < 20; i++) {
      now += 1000;
      s.tick();
    }
    const a = s.observability.read(id);
    assert.equal(a.totals.onlineMs, 10000);
    assert.equal(a.totals.offlineMs, 20000);
    assert.equal(a.totals.unknownMs, 86400000 - 30000);
  } finally {
    s.close();
  }
});
test("persistent observations survive restart without filling downtime and old minute buckets expire", () => {
  const dir = mkdtempSync(join(tmpdir(), "nightcare-observation-"));
  let now = base;
  const path = join(dir, "test.sqlite");
  let s = new Store(path, () => now, root);
  try {
    s.brokerChanged(true);
    ingest(s);
    for (let i = 0; i < 60; i++) {
      if (i % 15 === 0) ingest(s);
      now += 1000;
      s.tick();
    }
    const before = s.observability.read(id);
    s.close();
    now += 3600000;
    s = new Store(path, () => now, root);
    s.brokerChanged(true);
    for (let i = 0; i < 60; i++) {
      now += 1000;
      s.tick();
    }
    assert.equal(
      s.observability.read(id).totals.onlineMs,
      before.totals.onlineMs,
    );
    assert.equal(s.observability.read(id).messages, before.messages);
    assert.equal(s.observability.read(id).totals.offlineMs, 0);
    now += 31 * 86400000;
    s.tick();
    assert.equal(
      (
        s.db.prepare("SELECT count(*) AS n FROM observation_minutes").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("observability API validates device and period; collection filters bind cursors and retain legacy event response", async () => {
  let now = base;
  const s = new Store(":memory:", () => now, root);
  const app = await buildApp(s, () => true);
  try {
    s.brokerChanged(true);
    ingest(s);
    assert.equal(
      (await app.inject({ url: `/api/devices/${id}/observability` }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: `/api/devices/${id}/observability?period=7d` }))
        .statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: "/api/devices/unknown/observability" }))
        .statusCode,
      404,
    );
    for (let i = 0; i < 32; i++) {
      const at = base + i * 1000;
      s.db
        .prepare(
          "INSERT INTO commands(device_id,command_id,request_id,action,payload,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          `c${i}`,
          "r",
          i % 2 ? "ACK_HELP" : "CLOSE_HELP",
          "{}",
          i % 2 ? "APPLIED" : "REJECTED",
          at,
          at + 60000,
        );
      s.db
        .prepare(
          "INSERT INTO device_configs(device_id,config_version,payload,status,created_at) VALUES (?,?,?,?,?)",
        )
        .run(id, i + 1, "{}", i % 2 ? "APPLIED" : "PENDING", at);
      s.db
        .prepare(
          "INSERT INTO assistance_requests(device_id,request_id,status,updated_at,opened_at) VALUES (?,?,?,?,?)",
        )
        .run(id, `r${i}`, i % 2 ? "CLOSED" : "PENDING", at, at);
    }
    const start = new Date(base + 5000).toISOString(),
      end = new Date(base + 25000).toISOString();
    for (const kind of ["commands", "configs", "requests"]) {
      const status = kind === "requests" ? "CLOSED" : "APPLIED";
      const url = `/api/devices/${id}/${kind}?status=${status}&from=${start}&to=${end}&limit=2`;
      const first = (await app.inject({ url })).json();
      assert.equal(first.items.length, 2);
      assert.ok(first.items.every((r: any) => r.status === status));
      assert.ok(first.nextCursor);
      const next = (
        await app.inject({ url: url + `&cursor=${first.nextCursor}` })
      ).json();
      assert.equal(next.items.length, 2);
      assert.equal(
        (
          await app.inject({
            url: url.replace(status, "PENDING") + `&cursor=${first.nextCursor}`,
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await app.inject({
            url: `/api/devices/${id}/${kind}?from=${end}&to=${start}`,
          })
        ).statusCode,
        400,
      );
    }
    const applied = (
      await app.inject({ url: `/api/devices/${id}/commands?action=ACK_HELP` })
    ).json();
    assert.equal(applied.items.length, 16);
    assert.ok(applied.items.every((r: any) => r.action === "ACK_HELP"));
    assert.equal(
      (await app.inject({ url: `/api/devices/${id}/configs?action=ACK_HELP` }))
        .statusCode,
      400,
    );
    ingest(s, "events");
    assert.ok(
      Array.isArray(
        (await app.inject({ url: `/api/devices/${id}/events` })).json(),
      ),
    );
  } finally {
    await app.close();
    s.close();
  }
});

test("repeated state counts as communication without renewing liveness and backward clock does not double count", () => {
  let now = base;
  const s = new Store(":memory:", () => now, root);
  try {
    s.brokerChanged(true);
    ingest(s, "state", false, id, { sequence: 100000 });
    for (let i = 0; i < 30; i++) {
      now += 1000;
      s.tick();
    }
    ingest(s, "state", false, id, { sequence: 100000 });
    for (let i = 0; i < 30; i++) {
      now += 1000;
      s.tick();
    }
    const before = s.observability.read(id);
    assert.equal(before.messages, 2);
    assert.equal(before.totals.onlineMs, 45000);
    assert.equal(before.totals.offlineMs, 15000);
    now -= 30000;
    s.tick();
    for (let i = 0; i < 30; i++) {
      now += 1000;
      s.tick();
    }
    assert.deepEqual(s.observability.read(id).totals, before.totals);
  } finally {
    s.close();
  }
});
