import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const notificationCategories = [
  "presence",
  "lighting",
  "motion",
  "assistance",
  "configuration",
  "commands",
  "administration",
  "diagnostics",
  "system",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export type NotificationInput = {
  source: string;
  type: string;
  category: NotificationCategory;
  title: string;
  deviceId?: string;
  severity?: "info" | "warning" | "urgent";
  reference?: string;
  occurredAt?: string | null;
  detail?: string | null;
};
export type NotificationRow = {
  id: number;
  type: string;
  category: NotificationCategory;
  severity: "info" | "warning" | "urgent";
  title: string;
  deviceId: string | null;
  bedName: string | null;
  reference: string | null;
  occurredAt: string | null;
  receivedAt: number;
  detail: string | null;
};
export function notificationReason(reason: string) {
  const descriptions: Record<string, string> = {
    OK: "Operação confirmada pelo dispositivo.",
    STATE_CONFIRMED: "Aplicação confirmada pelo estado do dispositivo.",
    ALREADY_APPLIED: "A operação já havia sido aplicada.",
    ACK_TIMEOUT:
      "Não houve confirmação em 10 segundos; a aplicação ainda pode ser confirmada posteriormente.",
    INVALID_CONFIG: "O dispositivo recusou uma configuração inválida.",
    STALE_VERSION: "A configuração recebida é anterior à versão já aplicada.",
    VERSION_CONFLICT: "Esta versão já pertence a outra configuração.",
    PERSISTENCE_ERROR: "O dispositivo não conseguiu salvar a operação.",
    RETAINED_COMMAND:
      "O dispositivo recusou um comando antigo mantido pelo broker.",
    INVALID_COMMAND: "O dispositivo recusou um comando inválido.",
    ID_CONFLICT: "O identificador já pertence a outra operação.",
    CLOCK_INVALID: "O relógio do dispositivo não permite validar o comando.",
    CLOCK_SYNC_TIMEOUT: "O dispositivo não conseguiu sincronizar o relógio a tempo. Verifique a rede e tente novamente.",
    COMMAND_QUEUE_FULL: "O dispositivo já tem muitas ações aguardando sincronização. Aguarde os resultados antes de tentar novamente.",
    EXPIRED_OR_INVALID_TIME: "O comando expirou ou tem horários inválidos.",
    REQUEST_MISMATCH: "O chamado atual é diferente do informado no comando.",
    INVALID_TRANSITION: "A ação não é permitida no estado atual do chamado.",
  };
  return (
    descriptions[reason] ??
    (/^[A-Z_]+$/.test(reason)
      ? "Consulte o motivo informado no histórico da Administração."
      : reason)
  );
}
export class NotificationJournal {
  readonly installationId: string;
  readonly enabledAt: number;
  private lastCleanup = 0;
  constructor(
    private db: Database.Database,
    private now: () => number,
  ) {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS notification_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS notification_diagnostics(device_id TEXT PRIMARY KEY,state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS notifications(
          id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL,
          title TEXT NOT NULL, deviceId TEXT, bedName TEXT, reference TEXT,
          occurredAt TEXT, receivedAt INTEGER NOT NULL, detail TEXT);
        CREATE INDEX IF NOT EXISTS notifications_time ON notifications(receivedAt);
        CREATE INDEX IF NOT EXISTS notifications_device ON notifications(deviceId,id);
        CREATE INDEX IF NOT EXISTS notifications_category ON notifications(category,id);`);
      const insert = db.prepare(
        "INSERT OR IGNORE INTO notification_meta(key,value) VALUES (?,?)",
      );
      insert.run("installationId", randomUUID());
      insert.run("enabledAt", String(now()));
    })();
    this.installationId = (
      db
        .prepare(
          "SELECT value FROM notification_meta WHERE key='installationId'",
        )
        .get() as any
    ).value;
    this.enabledAt = Number(
      (
        db
          .prepare("SELECT value FROM notification_meta WHERE key='enabledAt'")
          .get() as any
      ).value,
    );
    this.cleanup(true);
  }
  add(input: NotificationInput) {
    if (
      this.db
        .prepare("SELECT 1 FROM notifications WHERE source=?")
        .get(input.source)
    )
      return;
    const bed = input.deviceId
      ? (this.db
          .prepare("SELECT name FROM beds WHERE device_id=?")
          .get(input.deviceId) as any)
      : null;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications(source,type,category,severity,title,deviceId,bedName,reference,occurredAt,receivedAt,detail)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.source,
        input.type,
        input.category,
        input.severity ?? "info",
        input.title,
        input.deviceId ?? null,
        bed?.name ?? null,
        input.reference ?? null,
        input.occurredAt ?? null,
        this.now(),
        input.detail ?? null,
      );
  }
  get latestId() {
    return (
      (
        this.db
          .prepare("SELECT seq FROM sqlite_sequence WHERE name='notifications'")
          .get() as any
      )?.seq ?? 0
    );
  }
  cleanup(force = false) {
    if (force || this.now() - this.lastCleanup >= 3600000) {
      this.db
        .prepare("DELETE FROM notifications WHERE receivedAt<?")
        .run(this.now() - 30 * 86400000);
      this.lastCleanup = this.now();
    }
  }
  page(query: {
    limit?: number;
    cursor?: string;
    category?: string;
    deviceId?: string;
    readThroughId?: number;
    afterId?: number;
    untilId?: number;
  }) {
    const filter = JSON.stringify([
      query.category ?? null,
      query.deviceId ?? null,
      query.afterId ?? null,
      query.untilId ?? null,
    ]);
    let before: number | null = null;
    if (query.cursor) {
      try {
        const c = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
        if (
          c.filter !== filter ||
          c.installationId !== this.installationId ||
          !Number.isSafeInteger(c.before) ||
          c.before < 1
        )
          throw new Error();
        before = c.before;
      } catch {
        throw Object.assign(new Error("INVALID_CURSOR"), { statusCode: 400 });
      }
    }
    const clauses = ["receivedAt>=?"];
    const values: (string | number)[] = [this.now() - 30 * 86400000];
    for (const [column, value, op] of [
      ["category", query.category, "="],
      ["deviceId", query.deviceId, "="],
      ["id", query.afterId, ">"],
      ["id", query.untilId, "<="],
      ["id", before, "<"],
    ] as const) {
      if (value !== undefined && value !== null) {
        clauses.push(`${column}${op}?`);
        values.push(value);
      }
    }
    const limit = query.limit ?? 30;
    const rows = this.db
      .prepare(
        `SELECT id,type,category,severity,title,deviceId,bedName,reference,occurredAt,receivedAt,detail FROM notifications WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`,
      )
      .all(...values, limit + 1) as NotificationRow[];
    const items = rows.slice(0, limit);
    return {
      installationId: this.installationId,
      latestId: this.latestId,
      unreadCount: (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM notifications WHERE id>? AND receivedAt>=?",
          )
          .get(query.readThroughId ?? 0, this.now() - 30 * 86400000) as any
      ).n,
      items,
      nextCursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({
                installationId: this.installationId,
                filter,
                before: items.at(-1)!.id,
              }),
            ).toString("base64url")
          : null,
    };
  }
}
