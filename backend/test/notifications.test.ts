import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { buildApp } from "../src/app.js";
const id = "nightcare-001",
  other = "nightcare-002",
  root = "nightcare/test/";
const state = {
  schemaVersion: 1,
  deviceId: id,
  bootId: "boot-a",
  sequence: 1,
  uptimeMs: 100,
  mode: "AUTO",
  lightOn: false,
  brightnessPct: 30,
  motion: false,
  assistanceStatus: "NONE",
  requestId: null,
  pressCount: 0,
  clockValid: true,
  appliedConfigVersion: 0,
  droppedEvents: 0,
  persistenceOk: true,
};
const config = {
  mode: "AUTO" as const,
  brightnessPct: 30,
  offDelaySec: 30,
  startTime: "22:00",
  endTime: "06:00",
  timezone: "America/Sao_Paulo" as const,
};
function ingest(s: Store, suffix: string, p: object, retained = false) {
  s.ingest(
    root + ((p as any).deviceId ?? id) + "/" + suffix,
    Buffer.from(JSON.stringify(p)),
    retained,
  );
}
function event(
  s: Store,
  type: string,
  eventId: string,
  deviceId = id,
  requestId: string | null = null,
) {
  ingest(s, "events", {
    schemaVersion: 1,
    deviceId,
    bootId: "boot-a",
    eventId,
    type,
    occurredAt: null,
    uptimeMs: 1,
    requestId,
    pressCount: 1,
  });
}
function list(s: Store) {
  return s.notifications.page({ limit: 100 }).items;
}
function count(s: Store, type: string) {
  return list(s).filter((n) => n.type === type).length;
}

test("notifications record presence transitions once, retained data and heartbeats do not announce liveness", () => {
  let now = 1700000000000;
  const s = new Store(":memory:", () => now, root);
  try {
    ingest(s, "state", state, true);
    assert.equal(count(s, "DEVICE_DISCOVERED"), 1);
    assert.equal(count(s, "DEVICE_ONLINE"), 0);
    ingest(s, "state", { ...state, sequence: 2 });
    assert.equal(count(s, "DEVICE_ONLINE"), 1);
    const last = s.notifications.latestId;
    ingest(s, "state", { ...state, sequence: 3 });
    s.tick();
    assert.equal(s.notifications.latestId, last);
    now += 45000;
    s.tick();
    s.tick();
    assert.equal(count(s, "DEVICE_OFFLINE"), 1);
    ingest(s, "state", { ...state, sequence: 4 });
    assert.equal(count(s, "DEVICE_ONLINE"), 2);
    s.brokerChanged(true);
    s.markDisconnected();
    s.markDisconnected();
    assert.equal(count(s, "BROKER_DISCONNECTED"), 1);
    assert.equal(count(s, "DEVICE_OFFLINE"), 1);
  } finally {
    s.close();
  }
});

test("notifications deduplicate MQTT events per device, recover active calls, preserve names and roll back rejected input", () => {
  const s = new Store(":memory:", undefined, root);
  try {
    ingest(s, "state", state);
    s.assign(id, "Leito 1");
    for (const type of [
      "MOTION_STARTED",
      "MOTION_ENDED",
      "LIGHT_ON",
      "LIGHT_OFF",
      "BOOT",
      "HELP_ACKNOWLEDGED",
      "HELP_CLOSED",
      "HELP_RECOVERED",
      "HELP_REITERATED",
    ]) {
      event(s, type, type, id, type.startsWith("HELP") ? "request-a" : null);
      event(s, type, type, id, type.startsWith("HELP") ? "request-a" : null);
      assert.equal(count(s, type), 1);
    }
    ingest(s, "state", {
      ...state,
      sequence: 2,
      requestId: "request-b",
      assistanceStatus: "PENDING",
      pressCount: 1,
    });
    event(s, "HELP_OPENED", "open", id, "request-b");
    assert.equal(count(s, "HELP_OPENED"), 1);
    event(s, "LIGHT_ON", "LIGHT_ON", other);
    assert.equal(count(s, "LIGHT_ON"), 2);
    const before = s.notifications.latestId;
    assert.throws(() =>
      ingest(s, "acks", {
        schemaVersion: 1,
        deviceId: id,
        commandId: "unknown",
        requestId: "x",
        status: "APPLIED",
        reason: "OK",
      }),
    );
    assert.equal(s.notifications.latestId, before);
    s.renameBed((s.beds()[0] as any).id, "Quarto Lua");
    assert.equal(
      list(s).find((n) => n.type === "BED_RENAMED")!.bedName,
      "Quarto Lua",
    );
    assert.equal(
      list(s).find((n) => n.type === "BED_ASSIGNED")!.bedName,
      "Leito 1",
    );
  } finally {
    s.close();
  }
});

test("diagnostics notify changes, initial faults and loss increments without heartbeat spam", () => {
  const s = new Store(":memory:", undefined, root);
  try {
    const bad = {
      ...state,
      clockValid: false,
      persistenceOk: false,
      droppedEvents: 2,
    };
    ingest(s, "state", bad, true);
    assert.equal(count(s, "CLOCK_FAILED"), 0);
    ingest(s, "state", { ...bad, sequence: 2 });
    assert.equal(count(s, "CLOCK_FAILED"), 1);
    assert.equal(count(s, "PERSISTENCE_FAILED"), 1);
    assert.equal(count(s, "EVENTS_DROPPED"), 1);
    const before = s.notifications.latestId;
    ingest(s, "state", { ...bad, sequence: 3 });
    assert.equal(s.notifications.latestId, before);
    ingest(s, "state", { ...state, sequence: 4, droppedEvents: 2 });
    assert.equal(count(s, "CLOCK_RECOVERED"), 1);
    assert.equal(count(s, "PERSISTENCE_RECOVERED"), 1);
    ingest(s, "state", { ...state, sequence: 5, droppedEvents: 3 });
    assert.equal(count(s, "EVENTS_DROPPED"), 2);
  } finally {
    s.close();
  }
});

test("configuration and command notifications correlate confirmations and timeouts without duplicating application events", async () => {
  let now = 1700000000000;
  const s = new Store(":memory:", () => now, root);
  try {
    ingest(s, "state", state);
    s.assign(id, "Leito 1");
    const c = await s.setConfig(config, id);
    assert.equal(count(s, "CONFIG_SENT"), 1);
    now += 10000;
    s.tick();
    s.tick();
    assert.equal(count(s, "CONFIG_UNCONFIRMED"), 1);
    event(s, "CONFIG_APPLIED", "cfg-event");
    ingest(s, "acks", {
      schemaVersion: 1,
      deviceId: id,
      configVersion: c.configVersion,
      status: "APPLIED",
      reason: "OK",
    });
    ingest(s, "state", {
      ...state,
      sequence: 2,
      appliedConfigVersion: c.configVersion,
    });
    assert.equal(count(s, "CONFIG_APPLIED"), 1);
    const c2 = await s.setConfig(config, id);
    ingest(s, "acks", {
      schemaVersion: 1,
      deviceId: id,
      configVersion: c2.configVersion,
      status: "REJECTED",
      reason: "STALE",
    });
    assert.equal(count(s, "CONFIG_REJECTED"), 1);
    ingest(s, "state", {
      ...state,
      sequence: 3,
      requestId: "r",
      assistanceStatus: "PENDING",
      pressCount: 1,
    });
    const cmd = { commandId: "c", requestId: "r", action: "ACK_HELP" as const };
    await s.command(cmd, id);
    await s.command(cmd, id);
    assert.equal(count(s, "COMMAND_SENT"), 1);
    now += 10000;
    s.tick();
    s.tick();
    assert.equal(count(s, "COMMAND_UNCONFIRMED"), 1);
    for (let i = 0; i < 2; i++)
      ingest(s, "acks", {
        schemaVersion: 1,
        deviceId: id,
        commandId: "c",
        requestId: "r",
        status: "APPLIED",
        reason: "OK",
      });
    assert.equal(count(s, "COMMAND_APPLIED"), 1);
  } finally {
    s.close();
  }
});

test("notification retention, installation identity and sequence survive restart without erasing technical history", () => {
  const dir = mkdtempSync(join(tmpdir(), "nightcare-notifications-"));
  let now = 1700000000000;
  const path = join(dir, "db.sqlite");
  let s = new Store(path, () => now, root);
  try {
    event(s, "LIGHT_ON", "old");
    ingest(s, "state", { ...state, clockValid: false });
    const installation = s.notifications.installationId;
    const latest = s.notifications.latestId;
    s.close();
    now += 31 * 86400000;
    s = new Store(path, () => now, root);
    assert.equal(s.notifications.installationId, installation);
    assert.ok(s.notifications.latestId > latest);
    assert.equal(count(s, "LIGHT_ON"), 0);
    ingest(s, "state", { ...state, sequence: 2, clockValid: false });
    assert.equal(count(s, "CLOCK_FAILED"), 0);
    assert.equal(s.history({}, id).length, 1);
    event(s, "LIGHT_ON", "old");
    assert.equal(count(s, "LIGHT_ON"), 0);
    event(s, "LIGHT_OFF", "new");
    assert.equal(count(s, "LIGHT_OFF"), 1);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("notification API paginates stable IDs, validates cursors and reports global unread counts independently of filters", async () => {
  const s = new Store(":memory:", undefined, root),
    app = await buildApp(s);
  try {
    for (let i = 0; i < 65; i++)
      event(
        s,
        i % 2 ? "LIGHT_ON" : "MOTION_STARTED",
        `e-${i}`,
        i % 2 ? id : other,
      );
    const response = await app.inject({
      method: "GET",
      url: "/api/notifications?limit=17",
    });
    assert.equal(response.statusCode, 200);
    const first = response.json();
    assert.equal(first.items.length, 17);
    assert.ok(first.nextCursor);
    const ids = first.items.map((n: any) => n.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const p = (
        await app.inject({
          method: "GET",
          url: `/api/notifications?limit=17&cursor=${encodeURIComponent(cursor)}`,
        })
      ).json();
      ids.push(...p.items.map((n: any) => n.id));
      cursor = p.nextCursor;
    }
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, list(s).length);
    const filtered = (
      await app.inject({
        method: "GET",
        url: `/api/notifications?category=lighting&deviceId=${id}&readThroughId=${first.latestId}`,
      })
    ).json();
    assert.equal(filtered.unreadCount, 0);
    assert.ok(
      filtered.items.every(
        (n: any) => n.category === "lighting" && n.deviceId === id,
      ),
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/notifications?category=lighting&cursor=${encodeURIComponent(first.nextCursor)}`,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/notifications?category=invalid",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/notifications?readThroughId=-1",
        })
      ).statusCode,
      400,
    );
    const status = (
      await app.inject({ method: "GET", url: "/api/status" })
    ).json();
    assert.equal(status.notifications.installationId, first.installationId);
    assert.equal(status.notifications.latestId, first.latestId);
    const range = (
      await app.inject({
        method: "GET",
        url: `/api/notifications?afterId=${ids[10]}&untilId=${ids[0]}`,
      })
    ).json();
    assert.equal(range.items.length, 10);
  } finally {
    await app.close();
    s.close();
  }
});
