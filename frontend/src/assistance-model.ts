import { useEffect, useRef, useState } from "react";
import { api, type Snapshot } from "./model";

export type AssistancePeriod = "24h" | "7d" | "30d" | "agenda";
export type AssistanceAnalytics = {
  deviceId: string;
  period: AssistancePeriod;
  from: number;
  to: number;
  timezoneOffsetHours: number;
  agendaReference: {
    startTime: string;
    endTime: string;
    timezoneOffsetHours: number;
    source: "telemetry" | "confirmed";
  } | null;
  callActivity: {
    start: number;
    end: number;
    count: number;
    partial: boolean;
  }[];
  requests: {
    total: number;
    pending: number;
    acknowledged: number;
    closed: number;
  };
  presses: { total: number; initial: number; reiterations: number };
  commands: {
    total: number;
    applied: number;
    rejected: number;
    pending: number;
    unconfirmed: number;
  };
};
export function useAssistanceAnalytics(
  snapshot: Snapshot | null,
  period: AssistancePeriod,
  active: boolean,
  connected: boolean,
  notificationRevision?: number,
) {
  const id = snapshot?.device.deviceId ?? "",
    key = `${id}:${period}`;
  const revision = JSON.stringify([
    notificationRevision,
    snapshot?.eventCount,
    snapshot?.device.state?.runtimeSettings?.timezoneOffsetHours,
    snapshot?.device.state?.runtimeSettings?.startTime,
    snapshot?.device.state?.runtimeSettings?.endTime,
    snapshot?.device.state?.appliedConfigVersion,
    snapshot?.appliedConfig?.config_version,
    snapshot?.requests.map((r) => [r.request_id, r.status]),
    snapshot?.commands.map((c) => [c.command_id, c.status]),
  ]);
  const [result, setResult] = useState<{
    key: string;
    data: AssistanceAnalytics | null;
    error: string;
    loading: boolean;
  }>({ key: "", data: null, error: "", loading: false });
  const [refresh, setRefresh] = useState(0);
  const lastRequest = useRef(0);
  useEffect(() => {
    if (!active || !connected || !id) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(
      () => {
        lastRequest.current = Date.now();
        setResult((old) => ({
          key,
          data: old.key === key ? old.data : null,
          error: "",
          loading: true,
        }));
        void api(
          `/api/devices/${encodeURIComponent(id)}/assistance-analytics?period=${period}`,
          undefined,
          controller.signal,
        )
          .then((data: AssistanceAnalytics) => {
            if (controller.signal.aborted) return;
            if (data.deviceId !== id || data.period !== period)
              throw Error("Resposta de outro dispositivo ou período.");
            setResult({ key, data, error: "", loading: false });
          })
          .catch((error) => {
            if (controller.signal.aborted) return;
            setResult((old) => ({
              key,
              data: old.key === key ? old.data : null,
              error: (error as Error).message,
              loading: false,
            }));
            retry = setTimeout(() => setRefresh((n) => n + 1), 5000);
          });
      },
      Math.max(0, 2000 - (Date.now() - lastRequest.current)),
    );
    return () => {
      clearTimeout(timer);
      clearTimeout(retry);
      controller.abort();
    };
  }, [id, key, period, active, connected, revision, refresh]);
  useEffect(() => {
    if (!active || !connected) return;
    const timer = setInterval(() => setRefresh((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, [active, connected]);
  return {
    data: result.key === key ? result.data : null,
    error: result.key === key ? result.error : "",
    loading: !!id && (result.key !== key || result.loading),
    refresh: () => {
      lastRequest.current = 0;
      setRefresh((n) => n + 1);
    },
  };
}
export type AssistanceQuery = ReturnType<typeof useAssistanceAnalytics>;
