export type LightingPeriod = "24h" | "7d" | "30d" | "agenda";
export type LightingAnalytics = {
  deviceId: string;
  period: LightingPeriod;
  from: number;
  to: number;
  timezoneOffsetHours: number;
  agendaReference: {
    startTime: string;
    endTime: string;
    timezoneOffsetHours: number;
    source: "telemetry" | "confirmed";
  } | null;
  totals: { movements: number; lightOns: number };
  approximateTimestampCount: number;
  hourlyMovements: {
    hour: number;
    movements: number;
    agendaFraction: number | null;
  }[];
  activity: {
    bucketStart: number;
    start: number;
    end: number;
    partial: boolean;
    movements: number;
    lightOns: number;
  }[];
  agendaDistribution: { inside: number; outside: number } | null;
};
export function localTime(
  value: number,
  offset: number,
  kind: "time" | "date" | "full" = "full",
) {
  const d = new Date(value + offset * 3600000);
  const day = d.toISOString().slice(0, 10).split("-").reverse().join("/");
  const time = d.toISOString().slice(11, 16);
  return kind === "time"
    ? time
    : kind === "date"
      ? day.slice(0, 5)
      : `${day} ${time}`;
}
