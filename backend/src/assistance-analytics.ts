import type Database from "better-sqlite3";
import {
  analyticsWindow,
  resolveAgendaReference,
  type AnalyticsPeriod,
} from "./analytics-window.js";

export type AssistancePeriod = AnalyticsPeriod;

export function assistanceAnalytics(
  db: Database.Database,
  deviceId: string,
  period: AssistancePeriod,
  now: number,
) {
  const agendaReference = resolveAgendaReference(db, deviceId);
  const device = db
    .prepare("SELECT state FROM devices WHERE device_id=?")
    .get(deviceId) as { state: string | null } | undefined;
  const effectiveOffset = device?.state
    ? JSON.parse(device.state)?.runtimeSettings?.timezoneOffsetHours
    : undefined;
  const effectiveTimezone =
    Number.isInteger(effectiveOffset) &&
    effectiveOffset >= -12 &&
    effectiveOffset <= 14
      ? effectiveOffset
      : (agendaReference?.timezoneOffsetHours ?? -3);
  const { from, to, step, offset, timezoneOffsetHours } = analyticsWindow(
    period,
    now,
    agendaReference,
    agendaReference?.timezoneOffsetHours ?? effectiveTimezone,
  );
  const first = Math.floor((from + offset) / step) * step - offset;
  const callActivity: {
    start: number;
    end: number;
    count: number;
    partial: boolean;
  }[] = [];
  for (let start = first; start < to; start += step) {
    callActivity.push({
      start: Math.max(start, from),
      end: Math.min(start + step, to),
      count: 0,
      partial: start < from || start + step > to,
    });
  }
  for (const row of db
    .prepare(
      `
    SELECT CAST((opened_at-?)/? AS INTEGER) AS bucket,COUNT(*) AS n
    FROM assistance_requests WHERE device_id=? AND opened_at>=? AND opened_at<?
    GROUP BY bucket
  `,
    )
    .all(first, step, deviceId, from, to) as { bucket: number; n: number }[]) {
    callActivity[row.bucket].count = row.n;
  }
  // Todas as janelas usam registros do backend, sem depender da deriva do ESP32.
  const requests = { total: 0, pending: 0, acknowledged: 0, closed: 0 };
  for (const row of db
    .prepare(
      `
    SELECT status,COUNT(*) AS n FROM assistance_requests
    WHERE device_id=? AND opened_at>=? AND opened_at<? GROUP BY status
  `,
    )
    .all(deviceId, from, to) as { status: string; n: number }[]) {
    requests.total += row.n;
    if (row.status === "PENDING") requests.pending += row.n;
    if (row.status === "ACKNOWLEDGED") requests.acknowledged += row.n;
    if (row.status === "CLOSED") requests.closed += row.n;
  }
  const presses = { total: 0, initial: 0, reiterations: 0 };
  for (const row of db
    .prepare(
      `
    SELECT type,COUNT(*) AS n FROM events
    WHERE device_id=? AND received_at>=? AND received_at<?
    AND type IN ('HELP_OPENED','HELP_REITERATED') GROUP BY type
  `,
    )
    .all(deviceId, from, to) as { type: string; n: number }[]) {
    if (row.type === "HELP_OPENED") presses.initial += row.n;
    else presses.reiterations += row.n;
  }
  presses.total = presses.initial + presses.reiterations;
  const commands = {
    total: 0,
    applied: 0,
    rejected: 0,
    pending: 0,
    unconfirmed: 0,
  };
  for (const row of db
    .prepare(
      `
    SELECT CASE WHEN status='PENDING' AND created_at<=? THEN 'UNCONFIRMED'
      ELSE status END AS result,COUNT(*) AS n FROM commands
    WHERE device_id=? AND created_at>=? AND created_at<? GROUP BY result
  `,
    )
    .all(now - 10000, deviceId, from, to) as { result: string; n: number }[]) {
    commands.total += row.n;
    if (row.result === "APPLIED") commands.applied += row.n;
    if (row.result === "REJECTED") commands.rejected += row.n;
    if (row.result === "PENDING") commands.pending += row.n;
    if (row.result === "UNCONFIRMED") commands.unconfirmed += row.n;
  }
  return {
    deviceId,
    period,
    from,
    to,
    agendaReference,
    timezoneOffsetHours,
    callActivity,
    requests,
    presses,
    commands,
  };
}
