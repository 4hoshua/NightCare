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
const presenceRows = [
  { key: "onlineMs", label: "Online", color: "#efd38e" },
  { key: "offlineMs", label: "Offline", color: "#8a819b" },
  { key: "unknownMs", label: "Sem observação", color: "#4b4758" },
] as const;
const exactDuration = (ms: number) =>
  `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}min ${((ms % 60000) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}s`;
function Plot({ data, presence }: { data: Observation; presence: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 400, height: 140 });
  const [entered, setEntered] = useState(false);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 700px)").matches,
  );
  const ref = useRef<HTMLDivElement>(null);
  const touchSelection = useRef(false);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(160, Math.floor(entry.contentRect.width)),
        height: Math.max(120, Math.floor(entry.contentRect.height)),
      }),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 700px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (selected === null) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        touchSelection.current = false;
        setSelected(null);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [selected]);
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
  const description = (i: number) => {
    const p = points[i];
    return `${date(p.from)}–${time(p.to)}\n${
      presence
        ? presenceRows
            .map((r) => `${r.label}: ${exactDuration(p[r.key])}`)
            .join("\n")
        : `${p.messages} mensagens recebidas`
    }`;
  };
  function keyboard(
    event: KeyboardEvent<HTMLButtonElement | SVGGElement>,
    i: number,
  ) {
    touchSelection.current = false;
    if (event.key === "Escape") {
      setSelected(null);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const n =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? points.length - 1
          : (i + (event.key === "ArrowLeft" ? -1 : 1) + points.length) %
            points.length;
    ref.current
      ?.querySelectorAll<
        HTMLButtonElement | SVGGElement
      >("[data-observation-point]")
      [n]?.focus();
  }
  const max = Math.max(
    2,
    Math.ceil(Math.max(...points.map((p) => p.messages)) / 2) * 2,
  );
  const { width, height } = size,
    left = 32,
    right = width - 12,
    bottom = height - 25,
    top = 12;
  const x = (i: number) =>
    left + (i * (right - left)) / Math.max(1, points.length - 1);
  const y = (value: number) =>
    bottom - (entered ? value / max : 0) * (bottom - top);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.messages)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1)},${bottom} L${x(0)},${bottom} Z`;
  const blocks = mobile ? [points.slice(0, 12), points.slice(12)] : [points];
  return (
    <div
      ref={ref}
      className={`observation-plot ${presence ? "observation-heatmap" : "observation-area"}`}
    >
      {presence ? (
        <div
          className="heatmap-blocks"
          role="group"
          aria-label="Mapa de calor da presença por hora"
        >
          {blocks.map((block, blockIndex) => (
            <div
              className="heatmap-block"
              key={blockIndex}
              style={{
                gridTemplateColumns: `82px repeat(${block.length},minmax(0,1fr))`,
              }}
            >
              <div className="heatmap-labels" aria-hidden="true">
                {presenceRows.map((r) => (
                  <span key={r.key}>{r.label}</span>
                ))}
              </div>
              {block.map((p, index) => {
                const i = blockIndex * 12 + index;
                return (
                  <button
                    key={p.from}
                    type="button"
                    className="heatmap-hour"
                    data-observation-point
                    aria-label={description(i)}
                    onPointerEnter={(event) => {
                      if (event.pointerType === "mouse")
                        touchSelection.current = false;
                    }}
                    onPointerDown={(event) => {
                      touchSelection.current = event.pointerType === "touch";
                    }}
                    onMouseEnter={() => setSelected(i)}
                    onMouseLeave={() => {
                      if (!touchSelection.current) setSelected(null);
                    }}
                    onFocus={() => setSelected(i)}
                    onBlur={() => setSelected(null)}
                    onClick={() => setSelected(i)}
                    onKeyDown={(e) => keyboard(e, i)}
                  >
                    {presenceRows.map((r) => (
                      <span key={r.key} className="heatmap-cell-track">
                        <i
                          className="heatmap-cell"
                          data-state={r.key}
                          data-duration-ms={p[r.key]}
                          style={{
                            background: r.color,
                            opacity: entered
                              ? Math.max(
                                  0,
                                  Math.min(1, p[r.key] / (p.to - p.from)),
                                )
                              : 0,
                          }}
                        />
                      </span>
                    ))}
                    {index % (mobile ? 3 : 4) === 0 && (
                      <span className="heatmap-hour-label" aria-hidden="true">
                        {time(p.from)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="group"
          aria-label="Área de mensagens MQTT recebidas por hora"
        >
          <g className="chart-axis" aria-hidden="true">
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={left}
                  x2={right}
                  y1={bottom - f * (bottom - top)}
                  y2={bottom - f * (bottom - top)}
                />
                <text
                  x={left - 6}
                  y={bottom - f * (bottom - top) + 3}
                  textAnchor="end"
                >
                  {(max * f).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })}
                </text>
              </g>
            ))}
          </g>
          <path
            className="observation-area-fill"
            d={area}
            style={{ d: `path("${area}")` }}
            aria-hidden="true"
          />
          <path
            className="observation-area-line"
            d={line}
            style={{ d: `path("${line}")` }}
            aria-hidden="true"
          />
          {points.map((p, i) => (
            <g
              key={p.from}
              data-observation-point
              tabIndex={0}
              role="img"
              aria-label={description(i)}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse")
                  touchSelection.current = false;
              }}
              onPointerDown={(event) => {
                touchSelection.current = event.pointerType === "touch";
              }}
              onMouseEnter={() => setSelected(i)}
              onMouseLeave={() => {
                if (!touchSelection.current) setSelected(null);
              }}
              onFocus={() => setSelected(i)}
              onBlur={() => setSelected(null)}
              onClick={() => setSelected(i)}
              onKeyDown={(e) => keyboard(e, i)}
            >
              <circle
                className="observation-area-point"
                cx={x(i)}
                cy={y(p.messages)}
                r={selected === i ? 4 : 2.5}
              />
              <rect
                x={x(i) - (right - left) / 46}
                y={top - 4}
                width={(right - left) / 23}
                height={bottom - top + 8}
                fill="transparent"
              />
              {i % (width < 400 ? 6 : 4) === 0 && (
                <text
                  x={x(i)}
                  y={height - 6}
                  textAnchor="middle"
                  className="chart-label"
                  aria-hidden="true"
                >
                  {time(p.from)}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
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
                Cada coluna representa uma hora; as três linhas indicam online,
                offline e sem observação. A intensidade de cada célula mostra a
                fração daquela hora no estado; célula vazia significa zero.
                Online exige estado novo e expira após 45 segundos; mensagem
                retida não confirma presença. Períodos sem observação não entram
                como offline.
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
                Cada ponto soma os recebimentos de uma hora; a linha liga esses
                totais sem estimar valores entre horários. Reentregas QoS contam
                novamente. Não mede requisições HTTP, latência ou todos os
                envios do dispositivo.
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
