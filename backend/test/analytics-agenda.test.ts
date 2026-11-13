import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { buildApp } from "../src/app.js";

const id = "nightcare-001";
const at = (value: string) => Date.parse(value);
function prepare(s: Store, runtime: object | null, version = 0) {
  const state = {
    schemaVersion: 1,
    deviceId: id,
    bootId: "agenda",
    sequence: 1,
    uptimeMs: 10,
    mode: "AUTO",
    lightOn: false,
    brightnessPct: 30,
    motion: false,
    assistanceStatus: "NONE",
    requestId: null,
    pressCount: 0,
    clockValid: true,
    appliedConfigVersion: version,
    droppedEvents: 0,
    persistenceOk: true,
    ...(runtime ? { runtimeSettings: { offDelaySec: 30, ...runtime } } : {}),
  };
  s.db
    .prepare("INSERT OR REPLACE INTO devices(device_id,state) VALUES (?,?)")
    .run(id, JSON.stringify(state));
}
const cases = [
  {
    name: "night in progress",
    now: "2026-11-13T04:00:00Z",
    start: "22:30",
    end: "06:15",
    offset: -3,
    from: "2026-11-13T01:30:00Z",
    to: "2026-11-13T04:00:00Z",
  },
  {
    name: "night already finished",
    now: "2026-11-13T15:00:00Z",
    start: "22:30",
    end: "06:15",
    offset: -3,
    from: "2026-11-13T01:30:00Z",
    to: "2026-11-13T09:15:00Z",
  },
  {
    name: "day in progress",
    now: "2026-11-13T15:20:00Z",
    start: "08:15",
    end: "17:45",
    offset: -3,
    from: "2026-11-13T11:15:00Z",
    to: "2026-11-13T15:20:00Z",
  },
  {
    name: "before day start uses previous execution",
    now: "2026-11-13T10:00:00Z",
    start: "08:15",
    end: "17:45",
    offset: -3,
    from: "2026-11-12T11:15:00Z",
    to: "2026-11-12T20:45:00Z",
  },
  {
    name: "equal times mean 24-hour execution",
    now: "2026-11-13T15:00:00Z",
    start: "00:00",
    end: "00:00",
    offset: -3,
    from: "2026-11-13T03:00:00Z",
    to: "2026-11-13T15:00:00Z",
  },
  {
    name: "UTC plus fourteen",
    now: "2026-11-13T15:00:00Z",
    start: "22:30",
    end: "06:15",
    offset: 14,
    from: "2026-11-13T08:30:00Z",
    to: "2026-11-13T15:00:00Z",
  },
  {
    name: "UTC minus twelve",
    now: "2026-11-13T15:00:00Z",
    start: "22:30",
    end: "06:15",
    offset: -12,
    from: "2026-11-13T10:30:00Z",
    to: "2026-11-13T15:00:00Z",
  },
  {
    name: "exact start has zero elapsed window",
    now: "2026-11-14T01:30:00Z",
    start: "22:30",
    end: "06:15",
    offset: -3,
    from: "2026-11-14T01:30:00Z",
    to: "2026-11-14T01:30:00Z",
  },
  {
    name: "exact end stops at agenda boundary",
    now: "2026-11-13T09:15:00Z",
    start: "22:30",
    end: "06:15",
    offset: -3,
    from: "2026-11-13T01:30:00Z",
    to: "2026-11-13T09:15:00Z",
  },
];
for (const c of cases)
  test(`lighting and assistance share agenda: ${c.name}`, () => {
    const s = new Store(":memory:", () => at(c.now));
    try {
      prepare(s, {
        startTime: c.start,
        endTime: c.end,
        timezoneOffsetHours: c.offset,
      });
      const a = s.assistanceAnalytics(id, "agenda"),
        b = s.lightingAnalytics(id, "agenda");
      assert.equal(a.from, at(c.from));
      assert.equal(a.to, at(c.to));
      assert.equal(a.from, b.from);
      assert.equal(a.to, b.to);
      assert.deepEqual(a.agendaReference, b.agendaReference);
      assert.equal(a.timezoneOffsetHours, c.offset);
      assert.equal(a.agendaReference?.source, "telemetry");
      assert.equal(
        a.callActivity.reduce((n, p) => n + p.end - p.start, 0),
        a.to - a.from,
      );
      assert.ok(
        a.callActivity.every(
          (p) => p.count === 0 && p.end - p.start <= 3600000,
        ),
      );
    } finally {
      s.close();
    }
  });

test("agenda reference uses effective telemetry, then exact confirmed version, never pending intent", () => {
  const s = new Store(":memory:", () => at("2026-11-13T15:00:00Z"));
  try {
    prepare(s, null, 1);
    for (const version of [1, 2])
      s.db
        .prepare(
          "INSERT INTO device_configs(device_id,config_version,payload,status,created_at) VALUES (?,?,?,?,?)",
        )
        .run(
          id,
          version,
          JSON.stringify({
            startTime: version === 1 ? "22:30" : "00:00",
            endTime: version === 1 ? "06:15" : "00:00",
          }),
          version === 1 ? "APPLIED" : "PENDING",
          s.now(),
        );
    for (const a of [
      s.assistanceAnalytics(id, "agenda"),
      s.lightingAnalytics(id, "agenda"),
    ]) {
      assert.equal(a.agendaReference?.source, "confirmed");
      assert.equal(a.agendaReference?.startTime, "22:30");
      assert.equal(a.from, at("2026-11-13T01:30:00Z"));
    }
    s.db
      .prepare("UPDATE devices SET state=? WHERE device_id=?")
      .run(
        JSON.stringify({
          appliedConfigVersion: 1,
          runtimeSettings: {
            startTime: "04:00",
            endTime: "05:00",
            timezoneOffsetHours: 2,
          },
        }),
        id,
      );
    assert.equal(
      s.assistanceAnalytics(id, "agenda").agendaReference?.source,
      "telemetry",
    );
    assert.equal(
      s.assistanceAnalytics(id, "agenda").agendaReference?.startTime,
      "04:00",
    );
    for (const appliedConfigVersion of [2, 99]) {
      s.db
        .prepare("UPDATE devices SET state=? WHERE device_id=?")
        .run(JSON.stringify({ appliedConfigVersion }), id);
      assert.throws(
        () => s.assistanceAnalytics(id, "agenda"),
        /AGENDA_UNAVAILABLE/,
      );
      assert.throws(
        () => s.lightingAnalytics(id, "agenda"),
        /AGENDA_UNAVAILABLE/,
      );
    }
  } finally {
    s.close();
  }
});

test("all assistance aggregates respect completed agenda bounds and hourly partial buckets", () => {
  const s = new Store(":memory:", () => at("2026-11-13T15:00:00Z"));
  try {
    prepare(s, {
      startTime: "22:30",
      endTime: "06:15",
      timezoneOffsetHours: -3,
    });
    const from = at("2026-11-13T01:30:00Z"),
      to = at("2026-11-13T09:15:00Z");
    for (const [n, t] of [from - 1, from, to - 1, to, s.now() - 1].entries()) {
      s.db
        .prepare(
          "INSERT INTO assistance_requests(device_id,request_id,status,press_count,updated_at,opened_at) VALUES (?,?,'CLOSED',1,?,?)",
        )
        .run(id, String(n), t, t);
      s.db
        .prepare(
          "INSERT INTO events(device_id,event_id,type,request_id,received_at,payload) VALUES (?,?,'HELP_OPENED',?,?,'{}')",
        )
        .run(id, String(n), String(n), t);
      s.db
        .prepare(
          "INSERT INTO commands(device_id,command_id,request_id,action,payload,status,created_at,expires_at) VALUES (?,?,?,'ACK_HELP','{}','APPLIED',?,?)",
        )
        .run(id, String(n), String(n), t, t + 60000);
    }
    const a = s.assistanceAnalytics(id, "agenda");
    assert.equal(a.requests.total, 2);
    assert.equal(a.presses.total, 2);
    assert.equal(a.commands.total, 2);
    assert.equal(
      a.callActivity.reduce((n, p) => n + p.count, 0),
      2,
    );
    assert.ok(a.callActivity[0].partial && a.callActivity.at(-1)!.partial);
    assert.equal(a.callActivity[0].count, 1);
    assert.equal(a.callActivity.at(-1)!.count, 1);
  } finally {
    s.close();
  }
});

test("assistance agenda HTTP reports unavailable reference and accepts known agenda", async () => {
  const s = new Store(":memory:", () => at("2026-11-13T15:00:00Z"));
  prepare(s, null);
  const app = await buildApp(s),
    url = `/api/devices/${id}/assistance-analytics?period=agenda`;
  try {
    const missing = await app.inject(url);
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().error, "AGENDA_UNAVAILABLE");
    s.db
      .prepare("UPDATE devices SET state=? WHERE device_id=?")
      .run(
        JSON.stringify({
          runtimeSettings: {
            startTime: "22:30",
            endTime: "06:15",
            timezoneOffsetHours: -3,
          },
        }),
        id,
      );
    const known = await app.inject(url);
    assert.equal(known.statusCode, 200);
    assert.equal(known.json().period, "agenda");
    assert.equal(known.json().agendaReference.source, "telemetry");
  } finally {
    await app.close();
    s.close();
  }
});
