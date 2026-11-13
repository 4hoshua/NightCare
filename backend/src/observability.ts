import type Database from "better-sqlite3";
const MINUTE = 60000,
  DAY = 86400000;
type Evidence = { status: "online" | "offline"; expiresAt: number };
/** Observations are local to this backend session; never resume liveness from disk. */
export class Observability {
  private evidence = new Map<string, Evidence>();
  private connected = false;
  private last: number;
  private cleaned: number;
  readonly enabledAt: number;
  constructor(
    private db: Database.Database,
    private now: () => number,
  ) {
    this.last = this.cleaned = now();
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS observation_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS observation_devices(device_id TEXT PRIMARY KEY REFERENCES devices(device_id),started_at INTEGER NOT NULL,last_contact INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS observation_minutes(device_id TEXT NOT NULL REFERENCES devices(device_id),minute INTEGER NOT NULL,online_ms INTEGER NOT NULL DEFAULT 0,offline_ms INTEGER NOT NULL DEFAULT 0,messages INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(device_id,minute));
        CREATE INDEX IF NOT EXISTS observation_cleanup ON observation_minutes(minute);`);
      db.prepare(
        "INSERT OR IGNORE INTO observation_meta VALUES ('enabled_at',?)",
      ).run(now());
    })();
    this.enabledAt = (
      db
        .prepare("SELECT value FROM observation_meta WHERE key='enabled_at'")
        .get() as { value: number }
    ).value;
    this.cleanup();
  }
  private add(id: string, start: number, end: number, online: boolean) {
    while (start < end) {
      const minute = Math.floor(start / MINUTE) * MINUTE;
      const until = Math.min(end, minute + MINUTE);
      this.db
        .prepare(
          `INSERT INTO observation_minutes(device_id,minute,online_ms,offline_ms) VALUES (?,?,?,?)
        ON CONFLICT(device_id,minute) DO UPDATE SET online_ms=online_ms+excluded.online_ms,offline_ms=offline_ms+excluded.offline_ms`,
        )
        .run(
          id,
          minute,
          online ? until - start : 0,
          online ? 0 : until - start,
        );
      start = until;
    }
  }
  pulse() {
    const end = this.now(),
      start = this.last;
    this.last = Math.max(start, end);
    // Scheduling stalls, suspension, clock corrections and downtime are unknown.
    if (this.connected && end >= start && end - start <= 5000) {
      this.db.transaction(() => {
        for (const [id, e] of this.evidence) {
          const split =
            e.status === "online"
              ? Math.max(start, Math.min(end, e.expiresAt))
              : start;
          if (split > start) this.add(id, start, split, true);
          if (split < end) this.add(id, split, end, false);
        }
      })();
    }
    if (end < start) this.evidence.clear();
    if (end - this.cleaned >= 3600000) this.cleanup();
  }
  broker(connected: boolean) {
    this.pulse();
    this.connected = connected;
    // Fresh state is required again after every broker outage.
    this.evidence.clear();
  }
  message(
    id: string,
    suffix: string,
    payload: { status?: string },
    retained: boolean,
    fresh = true,
  ) {
    if (retained) return;
    const now = this.now(),
      minute = Math.floor(now / MINUTE) * MINUTE;
    this.db
      .prepare(
        `INSERT INTO observation_devices VALUES (?,?,?) ON CONFLICT(device_id) DO UPDATE SET last_contact=excluded.last_contact`,
      )
      .run(id, now, now);
    this.db
      .prepare(
        `INSERT INTO observation_minutes(device_id,minute,messages) VALUES (?,?,1) ON CONFLICT(device_id,minute) DO UPDATE SET messages=messages+1`,
      )
      .run(id, minute);
    if (this.connected) {
      if (suffix === "state" && fresh)
        this.evidence.set(id, { status: "online", expiresAt: now + 45000 });
      else if (suffix === "availability" && payload.status === "offline")
        this.evidence.set(id, { status: "offline", expiresAt: Infinity });
    }
  }
  private cleanup() {
    this.cleaned = this.now();
    this.db
      .prepare("DELETE FROM observation_minutes WHERE minute<?")
      .run(Math.floor((this.cleaned - 30 * DAY) / MINUTE) * MINUTE);
  }
  read(id: string) {
    // Whole-minute window avoids inventing the position of counts inside a bucket.
    const to = Math.floor(this.now() / MINUTE) * MINUTE,
      from = to - DAY;
    const device = this.db
      .prepare("SELECT * FROM observation_devices WHERE device_id=?")
      .get(id) as { started_at: number; last_contact: number } | undefined;
    const rows = this.db
      .prepare(
        "SELECT * FROM observation_minutes WHERE device_id=? AND minute>=? AND minute<? ORDER BY minute",
      )
      .all(id, from, to) as {
      minute: number;
      online_ms: number;
      offline_ms: number;
      messages: number;
    }[];
    const byMinute = new Map(rows.map((r) => [r.minute, r]));
    const presence: {
      from: number;
      to: number;
      onlineMs: number;
      offlineMs: number;
      unknownMs: number;
    }[] = [];
    const hourly: { from: number; to: number; messages: number }[] = [];
    for (let minute = from; minute < to; minute += MINUTE) {
      const r = byMinute.get(minute),
        onlineMs = r?.online_ms ?? 0,
        offlineMs = r?.offline_ms ?? 0;
      presence.push({
        from: minute,
        to: minute + MINUTE,
        onlineMs,
        offlineMs,
        unknownMs: Math.max(0, MINUTE - onlineMs - offlineMs),
      });
    }
    for (let at = from; at < to; at += 3600000)
      hourly.push({
        from: at,
        to: at + 3600000,
        messages: rows
          .filter((r) => r.minute >= at && r.minute < at + 3600000)
          .reduce((sum, r) => sum + r.messages, 0),
      });
    return {
      deviceId: id,
      period: "24h" as const,
      from,
      to,
      enabledAt: this.enabledAt,
      startedAt: device?.started_at ?? null,
      lastContact: device?.last_contact ?? null,
      resolutionMs: MINUTE,
      totals: presence.reduce(
        (a, r) => ({
          onlineMs: a.onlineMs + r.onlineMs,
          offlineMs: a.offlineMs + r.offlineMs,
          unknownMs: a.unknownMs + r.unknownMs,
        }),
        { onlineMs: 0, offlineMs: 0, unknownMs: 0 },
      ),
      presence,
      hourly,
      messages: rows.reduce((sum, r) => sum + r.messages, 0),
    };
  }
}
