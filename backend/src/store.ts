import { Observability } from "./observability.js";
import Database from "better-sqlite3";
import {
  EVENT_TIME_SQL,
  lightingAnalytics,
  type LightingPeriod,
  type AgendaReference,
} from "./lighting-analytics.js";
import { randomUUID } from "node:crypto";
import { NotificationJournal, notificationReason } from "./notifications.js";
import {
  DEVICE,
  PREFIX,
  deviceIdSchema,
  settingsSchema,
  configSchema,
  eventSchema,
  stateSchema,
  ackSchema,
  availabilitySchema,
  type Settings,
  type CommandInput,
} from "./contracts.js";
export type Publisher = (
  topic: string,
  payload: string,
  retained: boolean,
) => Promise<void>;
export type HistoryQuery = {
  limit?: number;
  cursor?: string;
  type?: string;
  from?: string;
  to?: string;
};
const fail = (code: string, statusCode = 409): never => {
  throw Object.assign(new Error(code), { statusCode });
};
export class Store {
  db: Database.Database;
  publish?: Publisher;
  readonly rootPrefix: string;
  readonly notifications: NotificationJournal;
  readonly observability: Observability;
  private presence = new Map<string, boolean>();
  private brokerState: boolean | undefined;

  constructor(
    path: string,
    readonly now = () => Date.now(),
    readonly prefix = PREFIX,
  ) {
    this.rootPrefix = prefix.endsWith(`${DEVICE}/`)
      ? prefix.slice(0, -`${DEVICE}/`.length)
      : prefix;
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    const old = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='device_configs'",
      )
      .get();
    const legacy =
      (!!old &&
        !(
          this.db.prepare("PRAGMA table_info(device_configs)").all() as any[]
        ).some((c) => c.name === "device_id")) ||
      ((
        this.db.prepare("PRAGMA table_info(assistance_requests)").all() as any[]
      ).some((c) => c.name === "request_id") &&
        !(
          this.db
            .prepare("PRAGMA table_info(assistance_requests)")
            .all() as any[]
        ).some((c) => c.name === "device_id"));
    this.db.transaction(() => {
      if (legacy)
        this.db.exec(`
        CREATE TABLE IF NOT EXISTS device_configs(config_version INTEGER PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reason TEXT,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,type TEXT NOT NULL,request_id TEXT,occurred_at TEXT,received_at INTEGER NOT NULL,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS assistance_requests(request_id TEXT PRIMARY KEY,status TEXT NOT NULL,press_count INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS commands(command_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reason TEXT,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      `);
      if (legacy)
        for (const table of [
          "device_configs",
          "events",
          "assistance_requests",
          "commands",
        ])
          this.db.exec(`ALTER TABLE ${table} RENAME TO legacy_${table}`);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS devices(device_id TEXT PRIMARY KEY,state TEXT,state_seen INTEGER,last_seen INTEGER,availability TEXT NOT NULL DEFAULT 'offline');
        CREATE TABLE IF NOT EXISTS beds(id INTEGER PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,device_id TEXT NOT NULL UNIQUE REFERENCES devices(device_id),created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS device_configs(device_id TEXT NOT NULL DEFAULT 'nightcare-001' REFERENCES devices(device_id),config_version INTEGER NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reason TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(device_id,config_version));
        CREATE TABLE IF NOT EXISTS events(event_id TEXT NOT NULL,device_id TEXT NOT NULL REFERENCES devices(device_id),type TEXT NOT NULL,request_id TEXT,occurred_at TEXT,received_at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(device_id,event_id));
        CREATE TABLE IF NOT EXISTS assistance_requests(device_id TEXT NOT NULL DEFAULT 'nightcare-001' REFERENCES devices(device_id),request_id TEXT NOT NULL,status TEXT NOT NULL,press_count INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL,opened_at INTEGER NOT NULL,PRIMARY KEY(device_id,request_id));
        CREATE TABLE IF NOT EXISTS commands(device_id TEXT NOT NULL DEFAULT 'nightcare-001' REFERENCES devices(device_id),command_id TEXT NOT NULL,request_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reason TEXT,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(device_id,command_id));
      `);
      if (legacy) {
        this.db
          .prepare("INSERT OR IGNORE INTO devices(device_id) VALUES (?)")
          .run(DEVICE);
        this.db
          .exec(`INSERT INTO device_configs SELECT 'nightcare-001',config_version,payload,status,reason,created_at FROM legacy_device_configs;
          INSERT INTO events SELECT event_id,device_id,type,request_id,occurred_at,received_at,payload FROM legacy_events;
          INSERT INTO commands SELECT 'nightcare-001',command_id,request_id,action,payload,status,reason,created_at,expires_at FROM legacy_commands;`);
        const hasOpening = (
          this.db
            .prepare("PRAGMA table_info(legacy_assistance_requests)")
            .all() as any[]
        ).some((c) => c.name === "opened_at");
        this.db.exec(
          `INSERT INTO assistance_requests SELECT 'nightcare-001',request_id,status,press_count,updated_at,${hasOpening ? "COALESCE(opened_at,updated_at)" : "COALESCE((SELECT MIN(received_at) FROM events WHERE events.request_id=legacy_assistance_requests.request_id),updated_at)"} FROM legacy_assistance_requests`,
        );
        this.db
          .prepare(
            "INSERT INTO beds(name,name_key,device_id,created_at) VALUES (?,?,?,?)",
          )
          .run("Leito 1", "leito 1", DEVICE, this.now());
        for (const table of [
          "device_configs",
          "events",
          "assistance_requests",
          "commands",
        ])
          this.db.exec(`DROP TABLE legacy_${table}`);
      }
      this.db
        .exec(`CREATE INDEX IF NOT EXISTS events_page ON events(device_id,received_at,event_id);
        CREATE INDEX IF NOT EXISTS requests_page ON assistance_requests(device_id,opened_at,request_id);
        CREATE INDEX IF NOT EXISTS commands_page ON commands(device_id,created_at,command_id);`);
    })();
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS events_lighting_time ON events(device_id,${EVENT_TIME_SQL})`,
    );
    this.observability = new Observability(this.db, this.now);
    this.notifications = new NotificationJournal(this.db, this.now);
    this.notifications.add({
      source: `backend:${randomUUID()}`,
      type: "BACKEND_STARTED",
      category: "system",
      title: "Backend iniciado",
    });
    // Persisted telemetry is never evidence of a live connection after restart.
    this.db
      .prepare("UPDATE devices SET availability='offline',state_seen=NULL")
      .run();
  }
  brokerChanged(connected: boolean) {
    if (this.brokerState === connected) return;
    this.observability.broker(connected);
    this.brokerState = connected;
    this.notifications.add({
      source: `broker:${randomUUID()}`,
      type: connected ? "BROKER_CONNECTED" : "BROKER_DISCONNECTED",
      category: "system",
      severity: connected ? "info" : "warning",
      title: connected
        ? "Conexão com o broker estabelecida"
        : "Conexão com o broker indisponível",
      detail: connected
        ? null
        : "A presença dos dispositivos não pode ser confirmada enquanto o broker estiver desconectado.",
    });
  }
  markDisconnected() {
    this.db.transaction(() => {
      this.brokerChanged(false);
      this.db
        .prepare("UPDATE devices SET availability='offline',state_seen=NULL")
        .run();
      // A broker failure is reported globally, rather than as individual failures.
      this.presence.clear();
    })();
  }
  private reconcilePresence(id?: string) {
    for (const d of id ? [this.device(id)] : this.devices()) {
      const previous = this.presence.get(d.deviceId) ?? false;
      if (previous !== d.online)
        this.notifications.add({
          source: `presence:${randomUUID()}`,
          deviceId: d.deviceId,
          type: d.online ? "DEVICE_ONLINE" : "DEVICE_OFFLINE",
          category: "presence",
          severity: d.online ? "info" : "warning",
          title: d.online ? "Dispositivo online" : "Dispositivo offline",
          detail: d.online
            ? null
            : "Desconexão informada ou ausência de estado novo por 45 segundos.",
        });
      this.presence.set(d.deviceId, d.online);
    }
  }
  private configResult(
    id: string,
    version: number,
    status: string,
    reason: string,
  ) {
    this.notifications.add({
      source: `config:${id}:${version}:${status}`,
      deviceId: id,
      type: `CONFIG_${status}`,
      category: "configuration",
      severity: status === "APPLIED" ? "info" : "warning",
      title: `Configuração v${version} ${status === "APPLIED" ? "confirmada" : status === "REJECTED" ? "recusada" : "sem confirmação"}`,
      reference: String(version),
      detail: notificationReason(reason),
    });
  }
  beds() {
    return this.db
      .prepare(
        "SELECT id,name,device_id AS deviceId,created_at AS createdAt FROM beds ORDER BY id",
      )
      .all();
  }
  device(id = DEVICE) {
    const row = this.db
      .prepare("SELECT * FROM devices WHERE device_id=?")
      .get(id) as any;
    const bed =
      this.db.prepare("SELECT id,name FROM beds WHERE device_id=?").get(id) ??
      null;
    return {
      deviceId: id,
      bed,
      state: row?.state ? JSON.parse(row.state) : null,
      lastSeen: row?.last_seen ?? null,
      online:
        !!row &&
        row.availability === "online" &&
        row.state_seen !== null &&
        this.now() - row.state_seen < 45000,
    };
  }
  devices() {
    return (
      this.db
        .prepare("SELECT device_id FROM devices ORDER BY device_id")
        .all() as any[]
    ).map((r) => this.device(r.device_id));
  }
  requireDevice(id: string) {
    deviceIdSchema.parse(id);
    if (!this.db.prepare("SELECT 1 FROM devices WHERE device_id=?").get(id))
      fail("DEVICE_NOT_FOUND", 404);
    return this.device(id);
  }
  requireAssigned(id: string) {
    const d = this.requireDevice(id);
    if (!d.bed) fail("DEVICE_UNASSIGNED");
    return d;
  }
  legacyDevice() {
    const beds = this.beds() as any[];
    if (beds.length !== 1) fail("DEVICE_REQUIRED");
    return beds[0].deviceId as string;
  }
  assign(id: string, name: string) {
    return this.db.transaction(() => {
      const d = this.requireDevice(id);
      if (d.bed) fail("DEVICE_ALREADY_ASSIGNED");
      if (!d.online) fail("DEVICE_OFFLINE");
      const key = name.normalize("NFKC").toLocaleLowerCase("pt-BR");
      if (this.db.prepare("SELECT 1 FROM beds WHERE name_key=?").get(key))
        fail("BED_NAME_CONFLICT");
      const result = this.db
        .prepare(
          "INSERT INTO beds(name,name_key,device_id,created_at) VALUES (?,?,?,?)",
        )
        .run(name, key, id, this.now());
      this.notifications.add({
        source: `assign:${id}`,
        deviceId: id,
        type: "BED_ASSIGNED",
        category: "administration",
        title: "Dispositivo associado ao leito",
      });
      return { id: Number(result.lastInsertRowid), name, deviceId: id };
    })();
  }
  renameBed(id: number, name: string) {
    return this.db.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM beds WHERE id=?").get(id))
        fail("BED_NOT_FOUND", 404);
      const key = name.normalize("NFKC").toLocaleLowerCase("pt-BR");
      if (
        this.db
          .prepare("SELECT 1 FROM beds WHERE name_key=? AND id<>?")
          .get(key, id)
      )
        fail("BED_NAME_CONFLICT");
      const previous = (this.beds() as any[]).find((b) => b.id === id);
      this.db
        .prepare("UPDATE beds SET name=?,name_key=? WHERE id=?")
        .run(name, key, id);
      if (previous.name !== name)
        this.notifications.add({
          source: `rename:${randomUUID()}`,
          deviceId: previous.deviceId,
          type: "BED_RENAMED",
          category: "administration",
          title: "Nome do leito atualizado",
          detail: `${previous.name} → ${name}`,
        });
      return (this.beds() as any[]).find((b) => b.id === id);
    })();
  }
  ingest(topic: string, raw: Buffer, retained = false) {
    if (raw.length > 8192 || !topic.startsWith(this.rootPrefix))
      throw new Error("invalid topic/payload size");
    const parts = topic.slice(this.rootPrefix.length).split("/");
    if (parts.length !== 2 || !deviceIdSchema.safeParse(parts[0]).success)
      throw new Error("invalid topic");
    const [id, suffix] = parts;
    const schema = (
      {
        events: eventSchema,
        state: stateSchema,
        availability: availabilitySchema,
        acks: ackSchema,
      } as const
    )[suffix as "state"];
    if (!schema) throw new Error("unsupported topic");
    if (retained && (suffix === "events" || suffix === "acks"))
      throw new Error("retained event/ack");
    const input = schema.parse(JSON.parse(raw.toString()));
    if (input.deviceId !== id) throw new Error("device/topic mismatch");
    const now = this.now();
    this.observability.pulse();
    this.db.transaction(() => {
      // An unsolicited ACK is not a device announcement.
      if (suffix !== "acks") {
        const discovered = this.db
          .prepare("INSERT OR IGNORE INTO devices(device_id) VALUES (?)")
          .run(id);
        if (discovered.changes)
          this.notifications.add({
            source: `discovered:${id}`,
            deviceId: id,
            type: "DEVICE_DISCOVERED",
            category: "presence",
            title: "Dispositivo encontrado",
          });
      }
      const p = input as any;
      if (suffix === "events")
        this.db
          .prepare("UPDATE devices SET last_seen=? WHERE device_id=?")
          .run(now, id);
      if (suffix === "events") {
        const result = this.db
          .prepare(
            "INSERT OR IGNORE INTO events(event_id,device_id,type,request_id,occurred_at,received_at,payload) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            p.eventId,
            id,
            p.type,
            p.requestId,
            p.occurredAt,
            now,
            JSON.stringify(p),
          );
        if (result.changes && p.type !== "CONFIG_APPLIED") {
          const titles: Record<string, string> = {
            BOOT: "Dispositivo iniciado",
            MOTION_STARTED: "Movimento detectado",
            MOTION_ENDED: "Movimento encerrado",
            LIGHT_ON: "Luz acesa",
            LIGHT_OFF: "Luz apagada",
            HELP_OPENED: "Chamado aberto",
            HELP_REITERATED: "Pedido de ajuda reiterado",
            HELP_ACKNOWLEDGED: "Chamado reconhecido",
            HELP_CLOSED: "Chamado encerrado",
            HELP_RECOVERED: "Chamado recuperado após reinício",
          };
          this.notifications.add({
            source:
              p.type === "HELP_OPENED"
                ? `help:${id}:${p.requestId}:opened`
                : `event:${id}:${p.eventId}`,
            deviceId: id,
            type: p.type,
            category: p.type.startsWith("HELP_")
              ? "assistance"
              : p.type.startsWith("MOTION_")
                ? "motion"
                : p.type.startsWith("LIGHT_")
                  ? "lighting"
                  : "diagnostics",
            severity: [
              "HELP_OPENED",
              "HELP_REITERATED",
              "HELP_RECOVERED",
            ].includes(p.type)
              ? "urgent"
              : "info",
            title: titles[p.type],
            reference: p.requestId,
            occurredAt: p.occurredAt,
          });
        }
        if (result.changes && p.requestId) {
          const status =
            p.type === "HELP_CLOSED"
              ? "CLOSED"
              : p.type === "HELP_ACKNOWLEDGED"
                ? "ACKNOWLEDGED"
                : "PENDING";
          this.db
            .prepare(
              `INSERT INTO assistance_requests(device_id,request_id,status,press_count,updated_at,opened_at) VALUES (?,?,?,?,?,?) ON CONFLICT(device_id,request_id) DO UPDATE SET
            status=CASE WHEN assistance_requests.status='CLOSED' OR excluded.status='CLOSED' THEN 'CLOSED' WHEN assistance_requests.status='ACKNOWLEDGED' THEN 'ACKNOWLEDGED' ELSE excluded.status END,
            press_count=MAX(assistance_requests.press_count,excluded.press_count),updated_at=excluded.updated_at`,
            )
            .run(id, p.requestId, status, p.pressCount ?? 1, now, now);
        }
      } else if (suffix === "state") {
        const old = this.device(id).state;
        if (old?.bootId === p.bootId && p.sequence <= old.sequence) {
          this.observability.message(id, suffix, p, retained, false);
          return;
        }
        if (!retained) {
          const saved = this.db
            .prepare(
              "SELECT state FROM notification_diagnostics WHERE device_id=?",
            )
            .get(id) as any;
          const diagnostic = saved ? JSON.parse(saved.state) : null;
          for (const [field, bad, title, recovery] of [
            [
              "clockValid",
              false,
              "Relógio inválido ou em teste",
              "Relógio sincronizado",
            ],
            [
              "persistenceOk",
              false,
              "Falha de persistência no dispositivo",
              "Persistência restabelecida",
            ],
          ] as const) {
            if (
              (!diagnostic && p[field] === bad) ||
              (diagnostic && diagnostic[field] !== p[field])
            )
              this.notifications.add({
                source: `diagnostic:${id}:${p.bootId}:${p.sequence}:${field}`,
                deviceId: id,
                type: `${field === "clockValid" ? "CLOCK" : "PERSISTENCE"}_${p[field] ? "RECOVERED" : "FAILED"}`,
                category: "diagnostics",
                severity: p[field] ? "info" : "warning",
                title: p[field] ? recovery : title,
              });
          }
          if (
            p.droppedEvents >
            (diagnostic?.bootId === p.bootId ? diagnostic.droppedEvents : 0)
          )
            this.notifications.add({
              source: `loss:${id}:${p.bootId}:${p.sequence}`,
              deviceId: id,
              type: "EVENTS_DROPPED",
              category: "diagnostics",
              severity: "warning",
              title: "Dispositivo informou perda de eventos",
              detail: `Total neste reinício: ${p.droppedEvents}`,
            });
          if (
            p.requestId &&
            p.assistanceStatus === "PENDING" &&
            (diagnostic?.requestId !== p.requestId ||
              diagnostic?.assistanceStatus !== "PENDING")
          )
            this.notifications.add({
              source: `help:${id}:${p.requestId}:opened`,
              deviceId: id,
              type: "HELP_OPENED",
              category: "assistance",
              severity: "urgent",
              title: "Chamado ativo recebido",
              reference: p.requestId,
            });
          this.db
            .prepare(
              "INSERT INTO notification_diagnostics(device_id,state) VALUES (?,?) ON CONFLICT(device_id) DO UPDATE SET state=excluded.state",
            )
            .run(id, JSON.stringify(p));
        }
        this.db
          .prepare(
            "UPDATE devices SET state=?,state_seen=?,last_seen=?,availability=? WHERE device_id=?",
          )
          .run(
            JSON.stringify(p),
            retained ? null : now,
            now,
            retained ? "offline" : "online",
            id,
          );
        if (p.requestId)
          this.db
            .prepare(
              `INSERT INTO assistance_requests(device_id,request_id,status,press_count,updated_at,opened_at) VALUES (?,?,?,?,?,?) ON CONFLICT(device_id,request_id) DO UPDATE SET status=excluded.status,press_count=excluded.press_count,updated_at=excluded.updated_at`,
            )
            .run(id, p.requestId, p.assistanceStatus, p.pressCount, now, now);
        const config = this.db
          .prepare(
            "SELECT status FROM device_configs WHERE device_id=? AND config_version=?",
          )
          .get(id, p.appliedConfigVersion) as any;
        this.db
          .prepare(
            "UPDATE device_configs SET status='APPLIED',reason='STATE_CONFIRMED' WHERE device_id=? AND config_version=?",
          )
          .run(id, p.appliedConfigVersion);
        if (config && config.status !== "APPLIED")
          this.configResult(
            id,
            p.appliedConfigVersion,
            "APPLIED",
            "STATE_CONFIRMED",
          );
      } else if (suffix === "availability") {
        if (p.status === "offline" || !retained)
          this.db
            .prepare(
              "UPDATE devices SET availability=?,last_seen=? WHERE device_id=?",
            )
            .run(p.status, now, id);
      } else {
        if (p.commandId) {
          const row = this.db
            .prepare(
              "SELECT * FROM commands WHERE device_id=? AND command_id=?",
            )
            .get(id, p.commandId) as any;
          if (!row || p.requestId !== row.request_id)
            throw new Error("uncorrelated ack");
          const changed = this.db
            .prepare(
              "UPDATE commands SET status=?,reason=? WHERE device_id=? AND command_id=? AND status IN ('PENDING','UNCONFIRMED')",
            )
            .run(p.status, p.reason, id, p.commandId);
          if (changed.changes)
            this.commandResult({ ...row, status: p.status, reason: p.reason });
        } else {
          if (
            !this.db
              .prepare(
                "SELECT 1 FROM device_configs WHERE device_id=? AND config_version=?",
              )
              .get(id, p.configVersion)
          )
            throw new Error("uncorrelated config ack");
          const changed = this.db
            .prepare(
              "UPDATE device_configs SET status=?,reason=? WHERE device_id=? AND config_version=? AND status!='APPLIED' AND status!=?",
            )
            .run(p.status, p.reason, id, p.configVersion, p.status);
          if (changed.changes)
            this.configResult(id, p.configVersion, p.status, p.reason);
        }
      }
      this.observability.message(id, suffix, p, retained);
      this.reconcilePresence(id);
    })();
  }
  configs(id = DEVICE) {
    return this.db
      .prepare(
        "SELECT * FROM device_configs WHERE device_id=? ORDER BY config_version DESC LIMIT 30",
      )
      .all(id)
      .map((r: any) => ({ ...r, payload: JSON.parse(r.payload) }));
  }
  async setConfig(input: Settings, id = DEVICE) {
    const settings = settingsSchema.parse(input);
    this.requireAssigned(id);
    const payload = this.db.transaction(() => {
      const version = (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(config_version),0)+1 AS v FROM device_configs WHERE device_id=?",
          )
          .get(id) as any
      ).v;
      const p = configSchema.parse({
        ...settings,
        schemaVersion: 1,
        deviceId: id,
        configVersion: Math.max(
          version,
          (this.device(id).state?.appliedConfigVersion ?? 0) + 1,
        ),
      });
      this.db
        .prepare(
          "INSERT INTO device_configs(device_id,config_version,payload,created_at) VALUES (?,?,?,?)",
        )
        .run(id, p.configVersion, JSON.stringify(p), this.now());
      this.notifications.add({
        source: `config:${id}:${p.configVersion}:sent`,
        deviceId: id,
        type: "CONFIG_SENT",
        category: "configuration",
        title: `Configuração v${p.configVersion} enviada`,
        reference: String(p.configVersion),
      });
      return p;
    })();
    void this.tryPublish("config/set", JSON.stringify(payload), true, id);
    return payload;
  }
  async command(input: CommandInput, id = DEVICE) {
    const d = this.requireAssigned(id);
    const old = this.db
      .prepare("SELECT * FROM commands WHERE device_id=? AND command_id=?")
      .get(id, input.commandId) as any;
    if (old) {
      if (old.request_id !== input.requestId || old.action !== input.action)
        fail("ID_CONFLICT");
      return this.commandView(old);
    }
    if (!d.online) fail("DEVICE_OFFLINE");
    if (!d.state.clockValid) fail("CLOCK_INVALID");
    if (d.state.requestId !== input.requestId) fail("REQUEST_MISMATCH");
    if (
      d.state.assistanceStatus !==
      (input.action === "ACK_HELP" ? "PENDING" : "ACKNOWLEDGED")
    )
      fail("INVALID_TRANSITION");
    const now = this.now(),
      expires = now + 60000;
    const p = {
      ...input,
      schemaVersion: 1,
      deviceId: id,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expires).toISOString(),
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO commands(device_id,command_id,request_id,action,payload,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          id,
          input.commandId,
          input.requestId,
          input.action,
          JSON.stringify(p),
          now,
          expires,
        );
      this.notifications.add({
        source: `command:${id}:${input.commandId}:sent`,
        deviceId: id,
        type: "COMMAND_SENT",
        category: "commands",
        title: `${input.action === "ACK_HELP" ? "Reconhecimento" : "Encerramento"} enviado`,
        reference: input.commandId,
        detail: "Aguardando confirmação do dispositivo.",
      });
    })();
    void this.tryPublish("commands", JSON.stringify(p), false, id);
    return this.getCommand(input.commandId, id);
  }
  commandView(row: any) {
    return {
      ...row,
      payload: JSON.parse(row.payload),
      status:
        row.status === "PENDING" && this.now() - row.created_at >= 10000
          ? "UNCONFIRMED"
          : row.status,
    };
  }
  getCommand(commandId: string, id = DEVICE) {
    const row = this.db
      .prepare("SELECT * FROM commands WHERE device_id=? AND command_id=?")
      .get(id, commandId);
    return row ? this.commandView(row) : null;
  }
  private commandResult(row: any) {
    this.notifications.add({
      source: `command:${row.device_id}:${row.command_id}:${row.status}`,
      deviceId: row.device_id,
      type: `COMMAND_${row.status}`,
      category: "commands",
      severity: row.status === "APPLIED" ? "info" : "warning",
      title: `${row.action === "ACK_HELP" ? "Reconhecimento" : "Encerramento"} ${row.status === "APPLIED" ? "confirmado" : row.status === "REJECTED" ? "recusado" : "sem confirmação"}`,
      reference: row.command_id,
      detail: notificationReason(row.reason),
    });
  }
  tick() {
    this.observability.pulse();
    this.db.transaction(() => {
      const timedOut = this.db
        .prepare(
          "SELECT * FROM commands WHERE status='PENDING' AND created_at<=?",
        )
        .all(this.now() - 10000) as any[];
      this.db
        .prepare(
          "UPDATE commands SET status='UNCONFIRMED',reason='ACK_TIMEOUT' WHERE status='PENDING' AND created_at<=?",
        )
        .run(this.now() - 10000);
      for (const row of timedOut)
        if (row.created_at >= this.notifications.enabledAt)
          this.commandResult({
            ...row,
            status: "UNCONFIRMED",
            reason: "ACK_TIMEOUT",
          });
      for (const row of this.db
        .prepare(
          "SELECT device_id,config_version FROM device_configs WHERE status='PENDING' AND created_at>=? AND created_at<=?",
        )
        .all(
          Math.max(this.notifications.enabledAt, this.now() - 30 * 86400000),
          this.now() - 10000,
        ) as any[])
        this.configResult(
          row.device_id,
          row.config_version,
          "UNCONFIRMED",
          "Sem confirmação após 10 segundos; a intenção continua disponível para aplicação.",
        );
      this.reconcilePresence();
      this.notifications.cleanup();
    })();
  }
  async tryPublish(
    suffix: string,
    payload: string,
    retain: boolean,
    id = DEVICE,
  ) {
    try {
      await this.publish?.(
        `${this.rootPrefix}${id}/${suffix}`,
        payload,
        retain,
      );
    } catch {
      /* durable intent is replayed */
    }
  }
  async replay() {
    for (const bed of this.beds() as any[]) {
      const id = bed.deviceId;
      const cfg = this.configs(id)[0];
      if (cfg)
        await this.tryPublish(
          "config/set",
          JSON.stringify(cfg.payload),
          true,
          id,
        );
    }
    for (const row of this.db
      .prepare(
        "SELECT c.* FROM commands c JOIN beds b ON b.device_id=c.device_id WHERE c.status IN ('PENDING','UNCONFIRMED') AND c.expires_at>?",
      )
      .all(this.now()) as any[])
      await this.tryPublish("commands", row.payload, false, row.device_id);
  }
  history(query: HistoryQuery, id: string | null = DEVICE) {
    return this.page("events", { ...query, limit: query.limit ?? 100 }, id)
      .items;
  }
  page(
    kind: "events" | "requests" | "commands" | "configs",
    query: {
      limit?: number;
      cursor?: string;
      type?: string;
      from?: string;
      to?: string;
      status?: string;
      action?: string;
    },
    deviceId: string | null = DEVICE,
  ) {
    const definitions = {
      events: ["events", "received_at", "event_id"],
      requests: ["assistance_requests", "opened_at", "request_id"],
      commands: ["commands", "created_at", "command_id"],
      configs: ["device_configs", "config_version", "config_version"],
    } as const;
    const [table, sort, id] = definitions[kind];
    const filter = JSON.stringify([
      deviceId,
      query.type ?? null,
      query.from ?? null,
      query.to ?? null,
      query.status ?? null,
      query.action ?? null,
    ]);
    let cursor:
      | {
          kind: string;
          sort: number;
          id: string | number;
          deviceId: string;
          filter: string;
        }
      | undefined;
    if (query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
        if (
          !cursor ||
          cursor.kind !== kind ||
          !Number.isSafeInteger(cursor.sort) ||
          (kind === "configs"
            ? !Number.isSafeInteger(cursor.id)
            : typeof cursor.id !== "string") ||
          typeof cursor.deviceId !== "string" ||
          cursor.filter !== filter
        )
          throw new Error();
      } catch {
        throw Object.assign(new Error("INVALID_CURSOR"), { statusCode: 400 });
      }
    }
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (deviceId !== null) {
      clauses.push("device_id=?");
      values.push(deviceId);
    }
    if (kind === "events" && query.type) {
      clauses.push("type=?");
      values.push(query.type);
    }
    const timeColumn =
      kind === "events"
        ? "received_at"
        : kind === "requests"
          ? "opened_at"
          : "created_at";
    if (query.from) {
      clauses.push(`${timeColumn}>=?`);
      values.push(Date.parse(query.from));
    }
    if (query.to) {
      clauses.push(`${timeColumn}<=?`);
      values.push(Date.parse(query.to));
    }
    if (kind !== "events" && query.status) {
      clauses.push("status=?");
      values.push(query.status);
    }
    if (kind === "commands" && query.action) {
      clauses.push("action=?");
      values.push(query.action);
    }
    if (cursor) {
      clauses.push(
        `(${sort}<? OR (${sort}=? AND ${id}<?) OR (${sort}=? AND ${id}=? AND device_id<?))`,
      );
      values.push(
        cursor.sort,
        cursor.sort,
        cursor.id,
        cursor.sort,
        cursor.id,
        cursor.deviceId,
      );
    }
    const limit = query.limit ?? 100;
    const rows = this.db
      .prepare(
        `SELECT * FROM ${table} ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY ${sort} DESC,${id} DESC,device_id DESC LIMIT ?`,
      )
      .all(...values, limit + 1) as any[];
    const more = rows.length > limit;
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    return {
      items: selected.map((row) =>
        kind === "commands"
          ? this.commandView(row)
          : row.payload
            ? { ...row, payload: JSON.parse(row.payload) }
            : row,
      ),
      nextCursor:
        more && last
          ? Buffer.from(
              JSON.stringify({
                kind,
                sort: last[sort],
                id: last[id],
                deviceId: last.device_id,
                filter,
              }),
            ).toString("base64url")
          : null,
    };
  }
  lightingAnalytics(id: string, period: LightingPeriod) {
    const device = this.requireDevice(id),
      state = device.state;
    const runtime = state?.runtimeSettings;
    const applied = this.db
      .prepare(
        "SELECT payload FROM device_configs WHERE device_id=? AND config_version=? AND status='APPLIED'",
      )
      .get(id, state?.appliedConfigVersion ?? 0) as any;
    const confirmed = applied ? JSON.parse(applied.payload) : null;
    const agenda: AgendaReference | null = runtime
      ? {
          startTime: runtime.startTime,
          endTime: runtime.endTime,
          timezoneOffsetHours: runtime.timezoneOffsetHours,
          source: "telemetry",
        }
      : confirmed
        ? {
            startTime: confirmed.startTime,
            endTime: confirmed.endTime,
            timezoneOffsetHours: -3,
            source: "confirmed",
          }
        : null;
    if (period === "agenda" && !agenda) fail("AGENDA_UNAVAILABLE", 400);
    return lightingAnalytics(this.db, id, period, this.now(), agenda);
  }
  snapshot(id = DEVICE) {
    const device = this.device(id);
    const applied = this.db
      .prepare(
        "SELECT * FROM device_configs WHERE device_id=? AND config_version=?",
      )
      .get(id, device.state?.appliedConfigVersion ?? 0) as any;
    const activeRequest = device.state?.requestId
      ? this.db
          .prepare(
            "SELECT * FROM assistance_requests WHERE device_id=? AND request_id=?",
          )
          .get(id, device.state.requestId)
      : null;
    return {
      eventCount: (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM events WHERE device_id=?")
          .get(id) as any
      ).n,
      device,
      activeRequest,
      appliedConfig: applied
        ? { ...applied, payload: JSON.parse(applied.payload) }
        : null,
      configs: this.configs(id),
      requests: this.db
        .prepare(
          "SELECT * FROM assistance_requests WHERE device_id=? ORDER BY opened_at DESC,request_id DESC LIMIT 100",
        )
        .all(id),
      commands: (
        this.db
          .prepare(
            "SELECT * FROM commands WHERE device_id=? ORDER BY created_at DESC,command_id DESC LIMIT 30",
          )
          .all(id) as any[]
      ).map((r) => this.commandView(r)),
    };
  }
  overview() {
    const devices = this.devices(),
      beds = this.beds() as any[];
    return {
      ...(beds.length === 1 ? this.snapshot(beds[0].deviceId) : {}),
      devices,
      beds,
      notifications: {
        installationId: this.notifications.installationId,
        latestId: this.notifications.latestId,
      },
      snapshots: Object.fromEntries(
        devices.map((d) => [d.deviceId, this.snapshot(d.deviceId)]),
      ),
    };
  }
  close() {
    this.observability.pulse();
    this.db.close();
  }
}
