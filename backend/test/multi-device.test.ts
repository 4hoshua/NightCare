import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { buildApp } from "../src/app.js";
const root = "nightcare/demo/multi/";
const a = "nightcare-001",
  b = "nightcare-002";
const settings = {
  mode: "AUTO" as const,
  brightnessPct: 30,
  offDelaySec: 30,
  startTime: "22:00",
  endTime: "06:00",
  timezone: "America/Sao_Paulo" as const,
};
const state = (id: string, sequence = 1) => ({
  schemaVersion: 1,
  deviceId: id,
  bootId: "same-boot",
  sequence,
  uptimeMs: 100,
  mode: "AUTO",
  lightOn: false,
  brightnessPct: 30,
  motion: id === a,
  assistanceStatus: "PENDING",
  requestId: "same-request",
  pressCount: 1,
  clockValid: true,
  appliedConfigVersion: 0,
  droppedEvents: 0,
  persistenceOk: true,
});
const send = (
  s: Store,
  id: string,
  topic: string,
  payload: unknown,
  retain = false,
) =>
  s.ingest(
    root + id + "/" + topic,
    Buffer.from(JSON.stringify(payload)),
    retain,
  );
test("discovery, fresh presence, permanent association, name uniqueness and restart", async () => {
  let now = 1700000000000;
  const s = new Store(":memory:", () => now, root);
  const app = await buildApp(s);
  try {
    assert.equal(s.devices().length, 0);
    send(s, a, "state", state(a), true);
    assert.equal(s.device(a).online, false);
    assert.throws(() => s.assign(a, "Leito 1"), /DEVICE_OFFLINE/);
    await assert.rejects(s.setConfig(settings, a), /DEVICE_UNASSIGNED/);
    send(s, a, "state", state(a, 2));
    send(s, b, "state", state(b));
    const simultaneous = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/devices/${a}/assign`,
        payload: { name: "Leito 1" },
      }),
      app.inject({
        method: "POST",
        url: `/api/devices/${b}/assign`,
        payload: { name: "LEITO 1" },
      }),
    ]);
    assert.deepEqual(simultaneous.map((r) => r.statusCode).sort(), [201, 409]);
    assert.throws(() => s.assign(a, "Outro"), /DEVICE_ALREADY_ASSIGNED/);
    s.assign(b, "Leito 2");
    assert.throws(
      () => s.renameBed((s.device(b).bed as any).id, "Leito 1"),
      /BED_NAME_CONFLICT/,
    );
    s.renameBed((s.device(b).bed as any).id, "Leito B");
    assert.equal((s.device(b).bed as any).name, "Leito B");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/devices/${a}/assign`,
          payload: { name: "Outro", deviceId: b },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/commands",
          payload: {
            commandId: "x",
            requestId: "same-request",
            action: "ACK_HELP",
          },
        })
      ).json().error,
      "DEVICE_REQUIRED",
    );
    assert.equal((await app.inject("/api/events")).statusCode, 409);
    assert.equal((await app.inject("/api/events?scope=all")).statusCode, 200);
    now += 45000;
    assert.equal(s.device(a).online, false);
    assert.equal(s.device(b).online, false);
  } finally {
    await app.close();
    s.close();
  }
});
test("two devices isolate state, event/request/command IDs, versions, ACKs and replay", async () => {
  let now = 1700000000000;
  const s = new Store(":memory:", () => now, root);
  const sent: any[] = [];
  s.publish = async (...args) => {
    sent.push(args);
  };
  try {
    for (const [id, name] of [
      [a, "Leito 1"],
      [b, "Leito 2"],
    ]) {
      send(s, id, "state", state(id));
      s.assign(id, name);
      send(s, id, "events", {
        schemaVersion: 1,
        deviceId: id,
        bootId: "same-boot",
        eventId: "same-event",
        type: "HELP_OPENED",
        requestId: "same-request",
        pressCount: 1,
        uptimeMs: 10,
        occurredAt: null,
      });
    }
    assert.equal(s.history({}, null).length, 2);
    assert.equal(s.history({}, a).length, 1);
    assert.equal(s.device(a).state.motion, true);
    assert.equal(s.device(b).state.motion, false);
    const ac = await s.setConfig({ ...settings, brightnessPct: 55 }, a),
      bc = await s.setConfig({ ...settings, brightnessPct: 20 }, b);
    assert.equal(ac.configVersion, 1);
    assert.equal(bc.configVersion, 1);
    send(s, a, "acks", {
      schemaVersion: 1,
      deviceId: a,
      configVersion: 1,
      status: "APPLIED",
      reason: "OK",
    });
    assert.equal(s.configs(b)[0].status, "PENDING");
    const command = {
      commandId: "same-command",
      requestId: "same-request",
      action: "ACK_HELP" as const,
    };
    await s.command(command, a);
    await s.command(command, b);
    send(s, a, "acks", {
      schemaVersion: 1,
      deviceId: a,
      commandId: command.commandId,
      requestId: command.requestId,
      status: "APPLIED",
      reason: "OK",
    });
    assert.equal(s.getCommand(command.commandId, a).status, "APPLIED");
    assert.equal(s.getCommand(command.commandId, b).status, "PENDING");
    assert.throws(
      () =>
        send(s, b, "acks", {
          schemaVersion: 1,
          deviceId: a,
          commandId: command.commandId,
          requestId: command.requestId,
          status: "APPLIED",
          reason: "OK",
        }),
      /mismatch/,
    );
    send(s, a, "state", { ...state(a, 2), assistanceStatus: "ACKNOWLEDGED" });
    assert.equal(s.device(b).state.assistanceStatus, "PENDING");
    send(s, a, "availability", {
      schemaVersion: 1,
      deviceId: a,
      status: "offline",
    });
    assert.equal(s.device(a).online, false);
    assert.equal(s.device(b).online, true);
    const before = sent.length;
    await s.replay();
    assert.equal(sent.length, before + 3);
    assert.ok(sent.at(-1)[0].includes(b));
    const page = s.page("events", { limit: 1 }, null);
    assert.equal(page.items.length, 1);
    assert.ok(page.nextCursor);
    assert.equal(
      s.page("events", { limit: 1, cursor: page.nextCursor! }, null).items
        .length,
      1,
    );
    assert.throws(
      () => s.page("events", { cursor: page.nextCursor! }, a),
      /INVALID_CURSOR/,
    );
    now += 60001;
    const previous = sent.length;
    await s.replay();
    assert.equal(sent.length, previous + 2);
  } finally {
    s.close();
  }
});
test("invalid messages cannot create discovered devices or cross installations", () => {
  const s = new Store(":memory:", undefined, root);
  try {
    assert.throws(() => send(s, a, "state", { ...state(a), deviceId: b }));
    assert.throws(() => send(s, a, "state", { ...state(a), unexpected: true }));
    assert.throws(() =>
      s.ingest(
        "nightcare/demo/other/" + a + "/state",
        Buffer.from(JSON.stringify(state(a))),
      ),
    );
    assert.equal(s.devices().length, 0);
  } finally {
    s.close();
  }
});

test("two associations and scoped intentions survive a database reopen without false presence", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nightcare-beds-"));
  let s: Store | undefined;
  try {
    const path = join(dir, "db.sqlite");
    s = new Store(path, undefined, root);
    for (const [id, name] of [
      [a, "Leito 1"],
      [b, "Leito 2"],
    ]) {
      send(s, id, "state", state(id));
      s.assign(id, name);
      await s.setConfig(settings, id);
      await s.command(
        {
          commandId: "same-command",
          requestId: "same-request",
          action: "ACK_HELP",
        },
        id,
      );
    }
    s.close();
    s = new Store(path, undefined, root);
    assert.equal(s.beds().length, 2);
    assert.equal(s.devices().length, 2);
    for (const id of [a, b]) {
      assert.equal(s.device(id).online, false);
      assert.equal(s.configs(id)[0].config_version, 1);
      assert.equal(s.getCommand("same-command", id).request_id, "same-request");
      assert.throws(() => s.assign(id, "Changed"), /DEVICE_ALREADY_ASSIGNED/);
    }
  } finally {
    s?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
