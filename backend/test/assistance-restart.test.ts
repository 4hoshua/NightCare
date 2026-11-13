import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { DEVICE, PREFIX } from "../src/contracts.js";

test("assistance survives backend/device restart and late clock-sync ACK without renewing command validity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nightcare-clock-restart-"));
  const path = join(directory, "test.sqlite");
  let now = Date.parse("2026-11-13T14:36:20Z");
  let store = new Store(path, () => now);
  const ingest = (topic: string, payload: unknown, retained = false) =>
    store.ingest(PREFIX + topic, Buffer.from(JSON.stringify(payload)), retained);
  const state = {
    schemaVersion: 1, deviceId: DEVICE, bootId: "before-restart", sequence: 1,
    uptimeMs: 100, mode: "AUTO", lightOn: false, brightnessPct: 30,
    motion: false, assistanceStatus: "PENDING", requestId: "persistent-call",
    pressCount: 1, clockValid: true, appliedConfigVersion: 0,
    droppedEvents: 0, persistenceOk: true,
  };
  const command = {
    commandId: "persistent-ack", requestId: "persistent-call", action: "ACK_HELP" as const,
  };
  try {
    // Inicialização, vínculo e abertura antes da interrupção.
    ingest("state", state);
    store.assign(DEVICE, "Leito 1");
    const sent: any[] = [];
    store.publish = async (...args) => { sent.push(args); };
    await store.command(command);
    const original = store.getCommand(command.commandId).payload;
    assert.equal(sent.length, 1);
    store.close();

    // Reiniciar backend e dispositivo com o mesmo banco/namespace e chamado NVS.
    now += 12000;
    store = new Store(path, () => now);
    assert.equal(store.device().online, false);
    ingest("state", state, true);
    assert.equal(store.device().online, false);
    ingest("state", { ...state, bootId: "after-restart", sequence: 1 });
    assert.equal(store.device().online, true);
    assert.equal(store.beds().length, 1);
    store.publish = async (...args) => { sent.push(args); };
    store.tick();
    assert.equal(store.getCommand(command.commandId).status, "UNCONFIRMED");
    await store.replay();
    assert.equal(sent.length, 2);
    assert.equal(sent[1][2], false);
    assert.deepEqual(JSON.parse(sent[1][1]), original); // mesma intenção e prazo.

    // NTP concluiu: ACK tardio confirma o mesmo comando; não é preciso novo POST.
    now += 3000;
    ingest("acks", {
      schemaVersion: 1, deviceId: DEVICE, commandId: command.commandId,
      requestId: command.requestId, status: "APPLIED", reason: "OK",
    });
    ingest("state", { ...state, bootId: "after-restart", sequence: 2, assistanceStatus: "ACKNOWLEDGED" });
    assert.equal(store.getCommand(command.commandId).status, "APPLIED");
    assert.equal((await store.command(command)).status, "APPLIED");
    assert.equal(sent.length, 2);
    const close = { ...command, commandId: "persistent-close", action: "CLOSE_HELP" as const };
    await store.command(close);
    const deadline = store.getCommand(close.commandId).expires_at;
    store.close();

    // Reinício após o prazo não renova nem republica a intenção antiga.
    now = deadline;
    store = new Store(path, () => now);
    store.publish = async (...args) => { sent.push(args); };
    const beforeReplay = sent.length;
    await store.replay();
    assert.equal(sent.length, beforeReplay);
    assert.equal(store.getCommand(close.commandId).expires_at, deadline);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
