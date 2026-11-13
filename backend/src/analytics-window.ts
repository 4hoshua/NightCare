import type Database from "better-sqlite3";

export type AnalyticsPeriod = "24h" | "7d" | "30d" | "agenda";
export type AgendaReference = {
  startTime: string;
  endTime: string;
  timezoneOffsetHours: number;
  source: "telemetry" | "confirmed";
};

export function resolveAgendaReference(
  db: Database.Database,
  deviceId: string,
): AgendaReference | null {
  const row = db
    .prepare("SELECT state FROM devices WHERE device_id=?")
    .get(deviceId) as { state: string | null } | undefined;
  const state = row?.state ? JSON.parse(row.state) : null;
  const runtime = state?.runtimeSettings;
  if (
    typeof runtime?.startTime === "string" &&
    typeof runtime?.endTime === "string" &&
    Number.isInteger(runtime?.timezoneOffsetHours)
  ) {
    return {
      startTime: runtime.startTime,
      endTime: runtime.endTime,
      timezoneOffsetHours: runtime.timezoneOffsetHours,
      source: "telemetry",
    };
  }
  const applied = db
    .prepare(
      "SELECT payload FROM device_configs WHERE device_id=? AND config_version=? AND status='APPLIED'",
    )
    .get(deviceId, state?.appliedConfigVersion ?? 0) as
    | { payload: string }
    | undefined;
  if (!applied) return null;
  const confirmed = JSON.parse(applied.payload);
  return {
    startTime: confirmed.startTime,
    endTime: confirmed.endTime,
    timezoneOffsetHours: -3,
    source: "confirmed",
  };
}

export function analyticsWindow(
  period: AnalyticsPeriod,
  now: number,
  agenda: AgendaReference | null,
  timezoneOffsetHours = agenda?.timezoneOffsetHours ?? -3,
) {
  const offset = timezoneOffsetHours * 3600000;
  const days = period === "24h" ? 1 : period === "7d" ? 7 : 30;
  let from = now - days * 86400000,
    to = now;
  if (period === "agenda") {
    if (!agenda)
      throw Object.assign(new Error("AGENDA_UNAVAILABLE"), { statusCode: 400 });
    const minute = (value: string) =>
      Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const start = minute(agenda.startTime),
      end = minute(agenda.endTime);
    const day = Math.floor((now + offset) / 86400000) * 86400000 - offset;
    from = day + start * 60000;
    if (from > now) from -= 86400000;
    const duration = (end - start + 1440) % 1440 || 1440;
    to = Math.min(now, from + duration * 60000);
  }
  const step = period === "24h" || period === "agenda" ? 3600000 : 86400000;
  return { from, to, step, offset, timezoneOffsetHours };
}
