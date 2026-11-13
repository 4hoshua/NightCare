import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { api, date, type Snapshot } from "./model";
import { HelpTooltip } from "./HelpTooltip";
type Observation = {
  deviceId: string;
  period: "24h";
  from: number;
  to: number;
  enabledAt: number;
  startedAt: number | null;
  lastContact: number | null;
  resolutionMs: number;
  totals: { onlineMs: number; offlineMs: number; unknownMs: number };
  messages: number;
  presence: {
    from: number;
    to: number;
    onlineMs: number;
    offlineMs: number;
    unknownMs: number;
  }[];
  hourly: { from: number; to: number; messages: number }[];
};
const time = (n: number) =>
  new Date(n).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
const duration = (ms: number) =>
  `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}min`;
function useObservation(id: string, active: boolean, connected: boolean) {
  const [result, setResult] = useState<{
    id: string;
    data: Observation | null;
    error: string;
  }>({ id: "", data: null, error: "" });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!id || !active || !connected) return;
    let abort: AbortController | undefined;
    const load = () => {
      if (abort && !abort.signal.aborted) abort.abort();
      abort = new AbortController();
      const signal = abort.signal;
      void api(
        `/api/devices/${encodeURIComponent(id)}/observability?period=24h`,
        undefined,
        signal,
      )
        .then((data: Observation) => {
          if (!signal.aborted && data.deviceId === id)
            setResult({ id, data, error: "" });
        })
        .catch((e) => {
          if (!signal.aborted)
            setResult((old) => ({
              id,
              data: old.id === id ? old.data : null,
              error: (e as Error).message,
            }));
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      abort?.abort();
      clearInterval(timer);
    };
  }, [id, active, connected, refresh]);
  return {
    data: result.id === id ? result.data : null,
    error: result.id === id ? result.error : "",
    refresh: () => setRefresh((n) => n + 1),
  };
}
function Plot({ data, presence }: { data: Observation; presence: boolean }) {
  const [selected, setSelected] = useState<number | null>(null),
    [width, setWidth] = useState(400),
    [entered, setEntered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(400, Math.floor(entry.contentRect.width))),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const points = data.hourly.map((h) => ({
    ...h,
    ...data.presence
      .filter((p) => p.from >= h.from && p.from < h.to)
      .reduce(
        (a, p) => ({
          onlineMs: a.onlineMs + p.onlineMs,
          offlineMs: a.offlineMs + p.offlineMs,
          unknownMs: a.unknownMs + p.unknownMs,
        }),
        { onlineMs: 0, offlineMs: 0, unknownMs: 0 },
      ),
  }));
  const max = Math.max(1, ...points.map((p) => p.messages)),
    step = (width - 24) / 24;
  const description = (i: number) => {
    const p = points[i];
    return `${time(p.from)}–${time(p.to)}: ${presence ? `online ${duration(p.onlineMs)}, offline ${duration(p.offlineMs)}, sem observação ${duration(p.unknownMs)}` : `${p.messages} mensagens recebidas`}`;
  };
  function keyboard(e: KeyboardEvent<SVGGElement>, i: number) {
    if (e.key === "Escape") {
      setSelected(null);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? 23
          : (i + (e.key === "ArrowLeft" ? -1 : 1) + 24) % 24;
    ref.current
      ?.querySelectorAll<SVGGElement>("[data-observation-point]")
      [n]?.focus();
  }
  return (
    <div ref={ref} className="observation-plot">
      <div
        className="chart-scroll"
        tabIndex={0}
        role="region"
        aria-label={presence ? "Presença por hora" : "Mensagens por hora"}
      >
        <svg
          viewBox={`0 0 ${width} 120`}
          style={{ width, minWidth: width, height: 120 }}
          role="group"
          aria-label={
            presence
              ? "Distribuição de presença nas últimas 24 horas"
              : "Mensagens MQTT válidas nas últimas 24 horas"
          }
        >
          <line x1="12" x2={width - 12} y1="92" y2="92" stroke="#363744" />
          {points.map((p, i) => {
            let offset = 0;
            return (
              <g
                key={p.from}
                data-observation-point
                tabIndex={0}
                role="img"
                aria-label={description(i)}
                onMouseEnter={() => setSelected(i)}
                onMouseLeave={() => setSelected(null)}
                onFocus={() => setSelected(i)}
                onBlur={() => setSelected(null)}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => keyboard(e, i)}
              >
                {presence ? (
                  (
                    [
                      ["onlineMs", "#efd38e"],
                      ["offlineMs", "#8a819b"],
                      ["unknownMs", "#363744"],
                    ] as const
                  ).map(([key, color]) => {
                    const height = (p[key] / 3600000) * 76;
                    offset += height;
                    return (
                      <rect
                        key={key}
                        className="observation-bar"
                        x={12 + (i + 0.15) * step}
                        y={92 - offset}
                        width={step * 0.7}
                        height={height}
                        fill={color}
                        style={{ opacity: entered ? 1 : 0 }}
                      />
                    );
                  })
                ) : (
                  <rect
                    className="observation-message-bar"
                    x={12 + (i + 0.15) * step}
                    y="16"
                    width={step * 0.7}
                    height="76"
                    rx="2"
                    fill="#c7b080"
                    style={{
                      transform: `scaleY(${entered ? p.messages / max : 0})`,
                    }}
                  />
                )}
                <rect
                  x={12 + i * step}
                  y="12"
                  width={step}
                  height="82"
                  fill="transparent"
                />
                {i % 4 === 0 && (
                  <text
                    x={12 + (i + 0.5) * step}
                    y="110"
                    textAnchor="middle"
                    className="chart-label"
                  >
                    {time(p.from)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="chart-tooltip" aria-live="polite">
        {selected === null ? "" : description(selected)}
      </p>
    </div>
  );
}
export function ObservationCharts({
  snapshot,
  active,
  connected,
}: {
  snapshot: Snapshot | null;
  active: boolean;
  connected: boolean;
}) {
  const { data, error, refresh } = useObservation(
    snapshot?.device.deviceId ?? "",
    active,
    connected,
  );
  return (
    <div className="observation-charts">
      <div className="observation-context">
        <span>Últimas 24 horas {data && `· até ${time(data.to)}`}</span>
        <HelpTooltip label="Janela de observação">
          A janela termina no último minuto completo. Coleta iniciada em{" "}
          {date(data?.enabledAt ?? null)}; sem reconstrução de períodos antigos.
          Pausas do backend superiores a 5 segundos, indisponibilidade do broker
          e ausência de evidência são sem observação. O gráfico não garante
          funcionamento físico.
        </HelpTooltip>
      </div>
      {!connected && <p className="hint">Dados sem atualização ao vivo.</p>}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button className="secondary" onClick={refresh} disabled={!connected}>
            Tentar novamente
          </button>
        </p>
      )}
      {!data ? (
        <p className="empty">
          {!snapshot
            ? "Selecione um dispositivo para observar."
            : connected && !error
              ? "Carregando observabilidade…"
              : "Observabilidade indisponível."}
        </p>
      ) : (
        <>
          <article className="analytics-chart">
            <div className="chart-title">
              <h3>Presença observada</h3>
              <HelpTooltip label="Presença observada">
                Cada barra distribui uma hora entre online, offline e sem
                observação. Online exige estado novo e expira após 45 segundos;
                mensagem retida não confirma presença. Períodos sem observação
                não entram como offline.
              </HelpTooltip>
            </div>
            <div className="observation-totals observation-presence-totals">
              <span>
                Online <b>{duration(data.totals.onlineMs)}</b>
              </span>
              <span>
                Offline <b>{duration(data.totals.offlineMs)}</b>
              </span>
              <span>
                Sem observação <b>{duration(data.totals.unknownMs)}</b>
              </span>
            </div>
            <Plot
              key={`${data.deviceId}:presence:${active}`}
              data={data}
              presence
            />
          </article>
          <article className="analytics-chart">
            <div className="chart-title">
              <h3>Comunicações recebidas por hora</h3>
              <HelpTooltip label="Comunicações recebidas">
                Mensagens MQTT válidas, não retidas, recebidas pelo backend:
                estado, eventos, disponibilidade e confirmações correlacionadas.
                Reentregas QoS contam novamente. Não mede requisições HTTP,
                latência ou todos os envios do dispositivo.
              </HelpTooltip>
            </div>
            <div className="observation-totals">
              <span>
                Total na janela <b>{data.messages}</b>
              </span>
              <span>
                Último contato ao vivo <b>{date(data.lastContact)}</b>
              </span>
            </div>
            <Plot
              key={`${data.deviceId}:messages:${active}`}
              data={data}
              presence={false}
            />
          </article>
        </>
      )}
    </div>
  );
}
