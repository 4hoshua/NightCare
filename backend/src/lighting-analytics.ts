import type Database from "better-sqlite3";

// The same expression is used in the range query and its index. ROUND preserves
// millisecond boundaries despite floating point conversion through julianday.
export const EVENT_TIME_SQL =
  "COALESCE(CAST(ROUND((julianday(occurred_at)-2440587.5)*86400000) AS INTEGER),received_at)";
export type LightingPeriod = "24h" | "7d" | "30d" | "agenda";
export type AgendaReference = {
  startTime: string;
  endTime: string;
  timezoneOffsetHours: number;
  source: "telemetry" | "confirmed";
};
const minute = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function insideAgenda(minutes: number, agenda: AgendaReference) {
  const start = minute(agenda.startTime),
    end = minute(agenda.endTime);
  return (
    start === end ||
    (start < end
      ? minutes >= start && minutes < end
      : minutes >= start || minutes < end)
  );
}
export function lightingAnalytics(
  db: Database.Database,
  deviceId: string,
  period: LightingPeriod,
  now: number,
  agenda: AgendaReference | null,
) {
  const timezoneOffsetHours = agenda?.timezoneOffsetHours ?? -3,
    offset = timezoneOffsetHours * 3600000;
  const days = period === "24h" ? 1 : period === "7d" ? 7 : 30;
  let from = now - days * 86400000,
    to = now;
  if (period === "agenda") {
    if (!agenda) throw new Error("AGENDA_UNAVAILABLE");
    const start = minute(agenda.startTime),
      end = minute(agenda.endTime);
    const day = Math.floor((now + offset) / 86400000) * 86400000 - offset;
    from = day + start * 60000;
    if (from > now) from -= 86400000;
    const duration = (end - start + 1440) % 1440 || 1440;
    to = Math.min(now, from + duration * 60000);
  }
  const step = period === "24h" || period === "agenda" ? 3600000 : 86400000;
  const first = Math.floor((from + offset) / step) * step - offset;
  const activity = [];
  for (let start = first; start < to; start += step)
    activity.push({
      bucketStart: start,
      start: Math.max(start, from),
      end: Math.min(start + step, to),
      partial: start < from || start + step > to,
      movements: 0,
      lightOns: 0,
    });
  const hourlyMovements = Array.from({ length: 24 }, (_, hour) => {
    let agendaFraction: number | null = null;
    if (agenda) {
      const start = minute(agenda.startTime),
        end = minute(agenda.endTime);
      const spans =
        start === end
          ? [[0, 1440]]
          : start < end
            ? [[start, end]]
            : [
                [start, 1440],
                [0, end],
              ];
      agendaFraction =
        spans.reduce(
          (sum, [a, b]) =>
            sum +
            Math.max(0, Math.min(b, (hour + 1) * 60) - Math.max(a, hour * 60)),
          0,
        ) / 60;
    }
    return { hour, movements: 0, agendaFraction };
  });
  const totals = { movements: 0, lightOns: 0 };
  const agendaDistribution = agenda ? { inside: 0, outside: 0 } : null;
  let approximateTimestampCount = 0;
  const rows = db
    .prepare(
      `SELECT type,${EVENT_TIME_SQL} AS at,occurred_at FROM events
    WHERE device_id=? AND ${EVENT_TIME_SQL}>=? AND ${EVENT_TIME_SQL}<?
    AND type IN ('MOTION_STARTED','LIGHT_ON')`,
    )
    .iterate(deviceId, from, to);
  for (const row of rows as Iterable<{
    type: string;
    at: number;
    occurred_at: string | null;
  }>) {
    const local = new Date(row.at + offset),
      hour = local.getUTCHours();
    const bucket = activity[Math.floor((row.at - first) / step)];
    if (!row.occurred_at) approximateTimestampCount++;
    if (row.type === "MOTION_STARTED") {
      totals.movements++;
      hourlyMovements[hour].movements++;
      bucket.movements++;
      if (agenda && agendaDistribution)
        agendaDistribution[
          insideAgenda(hour * 60 + local.getUTCMinutes(), agenda)
            ? "inside"
            : "outside"
        ]++;
    } else {
      totals.lightOns++;
      bucket.lightOns++;
    }
  }
  return {
    deviceId,
    period,
    from,
    to,
    timezoneOffsetHours,
    agendaReference: agenda,
    totals,
    approximateTimestampCount,
    hourlyMovements,
    activity,
    agendaDistribution,
  };
}
