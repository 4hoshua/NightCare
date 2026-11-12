import Database from 'better-sqlite3';
import {
  DEVICE,
  PREFIX,
  settingsSchema,
  configSchema,
  eventSchema,
  stateSchema,
  ackSchema,
  availabilitySchema,
  type Settings,
  type CommandInput,
} from './contracts.js';

export type Publisher = (topic: string, payload: string, retained: boolean) => Promise<void>;

export class Store {
  db: Database.Database;
  publish?: Publisher;
  constructor(
    path: string,
    readonly now = () => Date.now(),
  ) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, state TEXT, state_seen INTEGER, last_seen INTEGER, availability TEXT NOT NULL DEFAULT 'offline');
      CREATE TABLE IF NOT EXISTS device_configs (config_version INTEGER PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', reason TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, type TEXT NOT NULL, request_id TEXT, occurred_at TEXT, received_at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_received ON events(received_at);
      CREATE TABLE IF NOT EXISTS assistance_requests (request_id TEXT PRIMARY KEY, status TEXT NOT NULL, press_count INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', reason TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    `);
    this.db.prepare('INSERT OR IGNORE INTO devices(device_id) VALUES (?)').run(DEVICE);
  }

  markDisconnected() {
    this.db.prepare("UPDATE devices SET availability='offline'").run();
  }

  device() {
    const row = this.db.prepare('SELECT * FROM devices WHERE device_id=?').get(DEVICE) as any;

    return {
      deviceId: DEVICE,
      state: row.state ? JSON.parse(row.state) : null,
      lastSeen: row.last_seen,
      online:
        row.availability === 'online' &&
        row.state_seen !== null &&
        this.now() - row.state_seen < 45000,
    };
  }

  ingest(topic: string, raw: Buffer, retained = false) {
    if (raw.length > 8192 || !topic.startsWith(PREFIX))
      throw new Error('invalid topic/payload size');

    const input = JSON.parse(raw.toString());
    const suffix = topic.slice(PREFIX.length);
    const now = this.now();

    this.db.transaction(() => {
      if (suffix === 'events') {
        if (retained) throw new Error('retained event');
        const e = eventSchema.parse(input);
        const result = this.db
          .prepare('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?)')
          .run(e.eventId, DEVICE, e.type, e.requestId, e.occurredAt, now, JSON.stringify(e));

        if (result.changes && e.requestId) {
          // Event replay contributes history; current device state is authoritative for active requests.
          const status =
            e.type === 'HELP_CLOSED'
              ? 'CLOSED'
              : e.type === 'HELP_ACKNOWLEDGED'
                ? 'ACKNOWLEDGED'
                : 'PENDING';

          this.db
            .prepare(
              `INSERT INTO assistance_requests VALUES (?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET
            status=CASE WHEN assistance_requests.status='CLOSED' THEN 'CLOSED' WHEN excluded.status='CLOSED' THEN 'CLOSED'
            WHEN assistance_requests.status='ACKNOWLEDGED' THEN 'ACKNOWLEDGED' ELSE excluded.status END,
            press_count=MAX(assistance_requests.press_count,excluded.press_count), updated_at=excluded.updated_at`,
            )
            .run(e.requestId, status, e.pressCount ?? 1, now);
        }
      } else if (suffix === 'state') {
        const s = stateSchema.parse(input);
        const old = this.device().state;

        if (old?.bootId === s.bootId && s.sequence <= old.sequence) return;
        // Retained state is a snapshot, never proof that the device is online now.
        this.db
          .prepare(
            'UPDATE devices SET state=?,state_seen=?,last_seen=?,availability=? WHERE device_id=?',
          )
          .run(
            JSON.stringify(s),
            retained ? null : now,
            now,
            retained ? 'offline' : 'online',
            DEVICE,
          );

        if (s.requestId)
          this.db
            .prepare(
              `INSERT INTO assistance_requests VALUES (?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET status=excluded.status,press_count=excluded.press_count,updated_at=excluded.updated_at`,
            )
            .run(s.requestId, s.assistanceStatus, s.pressCount, now);

        this.db
          .prepare(
            "UPDATE device_configs SET status='APPLIED',reason='STATE_CONFIRMED' WHERE config_version=?",
          )
          .run(s.appliedConfigVersion);
      } else if (suffix === 'availability') {
        const a = availabilitySchema.parse(input);

        if (a.status === 'offline' || !retained)
          this.db
            .prepare('UPDATE devices SET availability=?,last_seen=? WHERE device_id=?')
            .run(a.status, now, DEVICE);
      } else if (suffix === 'acks') {
        if (retained) throw new Error('retained ack');

        const a = ackSchema.parse(input);

        if (a.commandId) {
          const row = this.db
            .prepare('SELECT * FROM commands WHERE command_id=?')
            .get(a.commandId) as any;

          if (!row || a.requestId !== row.request_id) throw new Error('uncorrelated ack');

          this.db
            .prepare(
              "UPDATE commands SET status=?,reason=? WHERE command_id=? AND status IN ('PENDING','UNCONFIRMED')",
            )
            .run(a.status, a.reason, a.commandId);
        } else
          this.db
            .prepare(
              "UPDATE device_configs SET status=?,reason=? WHERE config_version=? AND status != 'APPLIED'",
            )
            .run(a.status, a.reason, a.configVersion);
      } else throw new Error('unsupported topic');
    })();
  }

  configs() {
    return this.db
      .prepare('SELECT * FROM device_configs ORDER BY config_version DESC LIMIT 30')
      .all()
      .map((x: any) => ({ ...x, payload: JSON.parse(x.payload) }));
  }

  async setConfig(input: Settings) {
    const settings = settingsSchema.parse(input);
    const payload = this.db.transaction(() => {
      const version = (
        this.db
          .prepare('SELECT COALESCE(MAX(config_version),0)+1 AS v FROM device_configs')
          .get() as any
      ).v;
      const applied = this.device().state?.appliedConfigVersion ?? 0;
      const p = configSchema.parse({
        ...settings,
        schemaVersion: 1,
        deviceId: DEVICE,
        configVersion: Math.max(version, applied + 1),
      });

      this.db
        .prepare('INSERT INTO device_configs(config_version,payload,created_at) VALUES (?,?,?)')
        .run(p.configVersion, JSON.stringify(p), this.now());

      return p;
    })();

    void this.tryPublish('config/set', JSON.stringify(payload), true);

    return payload;
  }

  async command(input: CommandInput) {
    const old = this.db
      .prepare('SELECT * FROM commands WHERE command_id=?')
      .get(input.commandId) as any;

    if (old) {
      if (old.request_id !== input.requestId || old.action !== input.action)
        throw new Error('ID_CONFLICT');

      return this.commandView(old);
    }

    const d = this.device();
    if (!d.online) throw new Error('DEVICE_OFFLINE');
    if (!d.state.clockValid) throw new Error('CLOCK_INVALID');
    if (d.state.requestId !== input.requestId) throw new Error('REQUEST_MISMATCH');
    if (d.state.assistanceStatus !== (input.action === 'ACK_HELP' ? 'PENDING' : 'ACKNOWLEDGED'))
      throw new Error('INVALID_TRANSITION');

    const now = this.now();
    const expires = now + 60000;
    const p = {
      ...input,
      schemaVersion: 1,
      deviceId: DEVICE,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expires).toISOString(),
    };

    this.db
      .prepare(
        'INSERT INTO commands(command_id,request_id,action,payload,created_at,expires_at) VALUES (?,?,?,?,?,?)',
      )
      .run(input.commandId, input.requestId, input.action, JSON.stringify(p), now, expires);

    void this.tryPublish('commands', JSON.stringify(p), false);

    return this.getCommand(input.commandId);
  }

  commandView(row: any) {
    return {
      ...row,
      payload: JSON.parse(row.payload),
      status:
        row.status === 'PENDING' && this.now() - row.created_at >= 10000
          ? 'UNCONFIRMED'
          : row.status,
    };
  }

  getCommand(id: string) {
    const r = this.db.prepare('SELECT * FROM commands WHERE command_id=?').get(id);

    return r ? this.commandView(r) : null;
  }

  tick() {
    this.db
      .prepare(
        "UPDATE commands SET status='UNCONFIRMED',reason='ACK_TIMEOUT' WHERE status='PENDING' AND created_at<=?",
      )
      .run(this.now() - 10000);
  }

  async tryPublish(suffix: string, payload: string, retain: boolean) {
    try {
      await this.publish?.(PREFIX + suffix, payload, retain);
    } catch {
      /* persisted intent is replayed on reconnect */
    }
  }

  async replay() {
    const cfg = this.db
      .prepare('SELECT payload FROM device_configs ORDER BY config_version DESC LIMIT 1')
      .get() as any;

    if (cfg) await this.tryPublish('config/set', cfg.payload, true);

    for (const c of this.db
      .prepare(
        "SELECT payload FROM commands WHERE status IN ('PENDING','UNCONFIRMED') AND expires_at>?",
      )
      .all(this.now()) as any[])

      await this.tryPublish('commands', c.payload, false);
  }

  history(query: { limit?: number; type?: string; from?: string; to?: string }) {
    return this.db
      .prepare(
        `SELECT * FROM events WHERE (? IS NULL OR type=?) AND (? IS NULL OR received_at>=?) AND (? IS NULL OR received_at<=?) ORDER BY received_at DESC,event_id DESC LIMIT ?`,
      )
      .all(
        query.type ?? null,
        query.type ?? null,
        query.from ? Date.parse(query.from) : null,
        query.from ? Date.parse(query.from) : null,
        query.to ? Date.parse(query.to) : null,
        query.to ? Date.parse(query.to) : null,
        query.limit ?? 100,
      )
      .map((x: any) => ({ ...x, payload: JSON.parse(x.payload) }));
  }

  snapshot() {
    return {
      device: this.device(),
      configs: this.configs(),
      requests: this.db
        .prepare('SELECT * FROM assistance_requests ORDER BY updated_at DESC LIMIT 100')
        .all(),
      commands: (
        this.db.prepare('SELECT * FROM commands ORDER BY created_at DESC LIMIT 30').all() as any[]
      ).map((x) => this.commandView(x)),
    };
  }

  close() {
    this.db.close();
  }

}
