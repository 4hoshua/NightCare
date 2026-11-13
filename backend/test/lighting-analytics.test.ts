import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { buildApp } from "../src/app.js";
import { EVENT_TIME_SQL, insideAgenda } from "../src/lighting-analytics.js";
const root = "nightcare/analytics/",
  id = "nightcare-001";
const now = Date.parse("2026-11-12T12:15:00Z");
function state(s: Store, extra: Record<string, unknown> = {}, deviceId = id) {
  s.ingest(
    root + deviceId + "/state",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        deviceId,
        bootId: "analytics",
        sequence: 1,
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
      }),
    ),
  );
}
function event(
  s: Store,
  eventId: string,
  at: string | null,
  type = "MOTION_STARTED",
  deviceId = id,
) {
  s.ingest(
    root + deviceId + "/events",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        deviceId,
        bootId: "analytics",
        eventId,
        occurredAt: at,
        type,
        uptimeMs: 100,
        requestId: null,
      }),
    ),
  );
}
const runtime = {
  startTime: "22:30",
  endTime: "06:15",
  offDelaySec: 30,
  timezoneOffsetHours: -3,
};
test("lighting aggregates all events, deduplicates and isolates devices with a timestamp expression index", () => {
  const s = new Store(":memory:", () => now, root);
  try {
    state(s, { runtimeSettings: runtime });
    for (let n = 0; n < 130; n++) event(s, "a" + n, "2026-11-12T03:00:00Z");
    event(s, "a0", "2026-11-12T03:00:00Z");
    event(s, "lamp", "2026-11-12T04:00:00Z", "LIGHT_ON");
    event(s, "irrelevant", "2026-11-12T04:00:00Z", "MOTION_ENDED");
    event(
      s,
      "other",
      "2026-11-12T03:00:00Z",
      "MOTION_STARTED",
      "nightcare-002",
    );
    const a = s.lightingAnalytics(id, "24h");
    assert.deepEqual(a.totals, { movements: 130, lightOns: 1 });
    assert.equal(a.hourlyMovements[0].movements, 130);
    assert.deepEqual(a.agendaDistribution, { inside: 130, outside: 0 });
    assert.equal(
      a.activity.reduce((sum, b) => sum + b.movements, 0),
      130,
    );
    const plan = s.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT type FROM events WHERE device_id=? AND ${EVENT_TIME_SQL}>=? AND ${EVENT_TIME_SQL}<?`,
      )
      .all(id, a.from, a.to) as any[];
    assert.ok(plan.some((p) => p.detail.includes("events_lighting_time")));
  } finally {
    s.close();
  }
});
test("agenda minute boundaries cross midnight, shade partial hours, and use receipt time explicitly when absent", () => {
  let clock = now - 1000;
  const s = new Store(":memory:", () => clock, root);
  try {
    state(s, { runtimeSettings: runtime });
    for (const [n, t] of [
      "2026-11-12T01:29:59Z",
      "2026-11-12T01:30:00Z",
      "2026-11-12T09:14:59Z",
      "2026-11-12T09:15:00Z",
    ].entries())
      event(s, String(n), t);
    event(s, "approx", null);
    clock = now;
    const a = s.lightingAnalytics(id, "24h");
    assert.deepEqual(a.agendaDistribution, { inside: 2, outside: 3 });
    assert.equal(a.approximateTimestampCount, 1);
    assert.equal(a.hourlyMovements[22].agendaFraction, 0.5);
    assert.equal(a.hourlyMovements[6].agendaFraction, 0.25);
    assert.equal(a.hourlyMovements[12].agendaFraction, 0);
    assert.equal(a.activity[0].partial, true);
    assert.equal(a.activity.at(-1)!.partial, true);
  } finally {
    s.close();
  }
});
test("rolling periods use exact boundaries and UTC offsets including missing and 24-hour agenda", () => {
  const s = new Store(":memory:", () => now, root);
  try {
    state(s);
    event(s, "start", new Date(now - 86400000).toISOString());
    event(s, "before", new Date(now - 86400001).toISOString());
    event(s, "end", new Date(now).toISOString());
    const a = s.lightingAnalytics(id, "24h");
    assert.equal(a.totals.movements, 1);
    assert.equal(a.agendaReference, null);
    assert.equal(a.agendaDistribution, null);
    assert.equal(s.lightingAnalytics(id, "7d").totals.movements, 2);
    assert.equal(s.lightingAnalytics(id, "30d").from, now - 30 * 86400000);
    state(s, {
      sequence: 2,
      runtimeSettings: {
        ...runtime,
        startTime: "09:00",
        endTime: "09:00",
        timezoneOffsetHours: 14,
      },
    });
    const b = s.lightingAnalytics(id, "24h");
    assert.deepEqual(b.agendaDistribution, { inside: 1, outside: 0 });
    assert.ok(b.hourlyMovements.every((h) => h.agendaFraction === 1));
    assert.equal(b.timezoneOffsetHours, 14);
  } finally {
    s.close();
  }
});
test("confirmed configuration is a fallback; pending intent never changes the analytics reference", async () => {
  const s = new Store(":memory:", () => now, root);
  try {
    state(s);
    s.assign(id, "Leito 1");
    const p = {
      mode: "AUTO" as const,
      brightnessPct: 30,
      offDelaySec: 30,
      startTime: "22:00",
      endTime: "06:00",
      timezone: "America/Sao_Paulo" as const,
    };
    const first = await s.setConfig(p, id);
    assert.equal(s.lightingAnalytics(id, "24h").agendaReference, null);
    state(s, { sequence: 2, appliedConfigVersion: first.configVersion });
    await s.setConfig({ ...p, startTime: "10:00" }, id);
    assert.equal(
      s.lightingAnalytics(id, "24h").agendaReference!.startTime,
      "22:00",
    );
    assert.equal(
      s.lightingAnalytics(id, "24h").agendaReference!.source,
      "confirmed",
    );
    state(s, {
      sequence: 3,
      appliedConfigVersion: first.configVersion,
      runtimeSettings: { ...runtime, startTime: "23:00" },
    });
    assert.equal(
      s.lightingAnalytics(id, "24h").agendaReference!.startTime,
      "23:00",
    );
  } finally {
    s.close();
  }
});
test("analytics API validates period and target and returns complete zero series for empty history", async () => {
  const s = new Store(":memory:", () => now, root),
    app = await buildApp(s);
  try {
    state(s);
    const r = await app.inject({
      method: "GET",
      url: `/api/devices/${id}/lighting-analytics`,
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().period, "24h");
    assert.equal(r.json().hourlyMovements.length, 24);
    assert.deepEqual(r.json().totals, { movements: 0, lightOns: 0 });
    for (const q of ["period=forever", "period=7d&extra=true"])
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: `/api/devices/${id}/lighting-analytics?${q}`,
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/devices/unknown/lighting-analytics",
        })
      ).statusCode,
      404,
    );
  } finally {
    await app.close();
    s.close();
  }
});

test("daytime agenda includes start, excludes end and preserves minute precision", () => {
  const agenda = {
    startTime: "09:15",
    endTime: "17:45",
    timezoneOffsetHours: -3,
    source: "telemetry" as const,
  };
  assert.equal(insideAgenda(9 * 60 + 14, agenda), false);
  assert.equal(insideAgenda(9 * 60 + 15, agenda), true);
  assert.equal(insideAgenda(17 * 60 + 44, agenda), true);
  assert.equal(insideAgenda(17 * 60 + 45, agenda), false);
  assert.equal(insideAgenda(23 * 60, agenda), false);
});

test("agenda period uses the latest applied window, clips active windows and excludes boundaries", () => {
  const cases = [
    {
      start: "22:30",
      end: "06:15",
      at: "2026-11-12T12:15:00Z",
      from: "2026-11-12T01:30:00Z",
      to: "2026-11-12T09:15:00Z",
    },
    {
      start: "22:30",
      end: "06:15",
      at: "2026-11-12T05:00:00Z",
      from: "2026-11-12T01:30:00Z",
      to: "2026-11-12T05:00:00Z",
    },
    {
      start: "08:00",
      end: "10:00",
      at: "2026-11-12T12:15:00Z",
      from: "2026-11-12T11:00:00Z",
      to: "2026-11-12T12:15:00Z",
    },
    {
      start: "08:00",
      end: "10:00",
      at: "2026-11-12T10:00:00Z",
      from: "2026-11-11T11:00:00Z",
      to: "2026-11-11T13:00:00Z",
    },
    {
      start: "00:00",
      end: "00:00",
      at: "2026-11-12T12:15:00Z",
      from: "2026-11-12T03:00:00Z",
      to: "2026-11-12T12:15:00Z",
    },
  ];
  for (const c of cases) {
    const s = new Store(":memory:", () => Date.parse(c.at), root);
    try {
      state(s, {
        runtimeSettings: { ...runtime, startTime: c.start, endTime: c.end },
      });
      event(s, "before", new Date(Date.parse(c.from) - 1).toISOString());
      event(s, "start", c.from);
      event(s, "end", c.to);
      const a = s.lightingAnalytics(id, "agenda");
      assert.equal(a.from, Date.parse(c.from));
      assert.equal(a.to, Date.parse(c.to));
      assert.equal(a.totals.movements, 1);
      assert.deepEqual(a.agendaDistribution, { inside: 1, outside: 0 });
      assert.equal(
        a.activity.reduce((n, b) => n + b.movements, 0),
        1,
      );
    } finally {
      s.close();
    }
  }
});
test("agenda API requires an applied reference and accepts agenda as a period", async () => {
  const s = new Store(":memory:", () => now, root),
    app = await buildApp(s);
  try {
    state(s);
    const url = `/api/devices/${id}/lighting-analytics?period=agenda`;
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 400);
    state(s, { runtimeSettings: runtime, sequence: 2 });
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().period, "agenda");
  } finally {
    await app.close();
    s.close();
  }
});
