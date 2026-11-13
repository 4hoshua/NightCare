import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { api, type Snapshot } from "./model";
import { Select } from "./Select";
import { HelpTooltip } from "./HelpTooltip";
import { Icon } from "./navigation";
import {
  localTime,
  type LightingAnalytics,
  type LightingPeriod,
} from "./lighting-model";
function useAnalytics(
  snapshot: Snapshot | null,
  period: LightingPeriod,
  active: boolean,
  connected: boolean,
) {
  const id = snapshot?.device.deviceId ?? "",
    key = `${id}:${period}`;
  const runtime = snapshot?.device.state?.runtimeSettings;
  const revision = `${snapshot?.eventCount}:${snapshot?.device.state?.appliedConfigVersion}:${runtime?.startTime}:${runtime?.endTime}:${runtime?.timezoneOffsetHours}`;
  const [result, setResult] = useState<{
    key: string;
    data: LightingAnalytics | null;
    error: string;
    loading: boolean;
  }>({ key: "", data: null, error: "", loading: false });
  const [refresh, setRefresh] = useState(0),
    lastRequest = useRef(0);
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
          `/api/devices/${encodeURIComponent(id)}/lighting-analytics?period=${period}`,
          undefined,
          controller.signal,
        )
          .then((data: LightingAnalytics) => {
            if (controller.signal.aborted) return;
            if (data.deviceId !== id || data.period !== period)
              throw Error("Resposta de outro dispositivo ou período.");
            setResult({ key, data, error: "", loading: false });
          })
          .catch((e) => {
            if (controller.signal.aborted) return;
            setResult((old) => ({
              key,
              data: old.key === key ? old.data : null,
              error: (e as Error).message,
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
    loading: result.key !== key || result.loading,
    refresh: () => {
      lastRequest.current = 0;
      setRefresh((n) => n + 1);
    },
  };
}
function useEntered() {
  const [entered, setEntered] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useLayoutEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return entered;
}
function usePlotWidth(minimum: number) {
  const ref = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState(minimum);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setMeasured(Math.floor(entry.contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, Math.max(minimum, measured)] as const;
}
function Bar({
  x,
  width,
  ratio,
  color,
}: {
  x: number;
  width: number;
  ratio: number;
  color: string;
}) {
  const entered = useEntered();
  return (
    <rect
      className={`chart-bar ${color}`}
      x={x}
      y={12}
      width={width}
      height={74}
      rx={3}
      style={{ transform: `scaleY(${entered ? ratio : 0})` }}
      aria-hidden="true"
    />
  );
}
function chartKeyboard(event: KeyboardEvent<SVGGElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = [
    ...event.currentTarget
      .closest("svg")!
      .querySelectorAll<SVGGElement>("[data-chart-point]"),
  ];
  const at = items.indexOf(event.currentTarget);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (at + (event.key === "ArrowRight" ? 1 : -1) + items.length) %
          items.length;
  items[next]?.focus();
}
function Axes({ max, width }: { max: number; width: number }) {
  return (
    <g aria-hidden="true" className="chart-axis">
      {[0, 0.5, 1].map((n) => (
        <g key={n}>
          <line x1={36} x2={width - 12} y1={86 - 74 * n} y2={86 - 74 * n} />
          <text x={29} y={90 - 74 * n} textAnchor="end">
            {Math.round(max * n)}
          </text>
        </g>
      ))}
    </g>
  );
}
function HourlyChart({ data }: { data: LightingAnalytics }) {
  const [selected, setSelected] = useState<number | null>(null),
    id = useId();
  const max = Math.max(
    2,
    Math.ceil(Math.max(...data.hourlyMovements.map((h) => h.movements)) / 2) *
      2,
  );
  const [plotRef, width] = usePlotWidth(400);
  const step = (width - 48) / 24;
  const agenda = data.agendaReference;
  const spans = agenda
    ? (() => {
        const minutes = (t: string) =>
          Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        const a = minutes(agenda.startTime),
          b = minutes(agenda.endTime);
        return a === b
          ? [[0, 1440]]
          : a < b
            ? [[a, b]]
            : [
                [a, 1440],
                [0, b],
              ];
      })()
    : [];
  return (
    <article
      ref={plotRef}
      className="analytics-chart hourly-chart"
      aria-labelledby={id}
    >
      <div className="chart-title">
        <h3 id={id}>Movimentos por hora do dia</h3>
        <HelpTooltip label="Movimentos por hora do dia">
          Cada barra soma os movimentos registrados naquela hora no período
          selecionado.
        </HelpTooltip>
      </div>
      <div className="chart-legend">
        <span>
          <i className="motion-key" />
          Movimentos
        </span>
        {agenda && (
          <span>
            <i className="agenda-key" />
            Agenda atual como referência
          </span>
        )}
      </div>
      {data.totals.movements === 0 ? (
        <p className="chart-empty">
          Nenhum movimento registrado neste período.
        </p>
      ) : (
        <div
          className="chart-scroll"
          tabIndex={0}
          role="region"
          aria-label="Gráfico de movimentos por hora; pode ser rolado horizontalmente"
        >
          <svg
            viewBox={`0 0 ${width} 120`}
            className="bar-chart"
            style={{ width, minWidth: width, height: 120 }}
            role="group"
            aria-labelledby={id}
          >
            <Axes max={max} width={width} />
            {spans.map(([start, end], i) => (
              <rect
                key={i}
                x={36 + (start / 60) * step}
                y={8}
                width={((end - start) / 60) * step}
                height={78}
                className="agenda-shade"
                aria-hidden="true"
              />
            ))}
            {data.hourlyMovements.map((h, index) => (
              <g
                key={h.hour}
                data-chart-point
                tabIndex={0}
                role="img"
                aria-label={`${String(h.hour).padStart(2, "0")}h: ${h.movements} movimentos`}
                onFocus={() => setSelected(index)}
                onMouseEnter={() => setSelected(index)}
                onMouseLeave={() => setSelected(null)}
                onBlur={() => setSelected(null)}
                onClick={() => setSelected(index)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSelected(null);
                  else chartKeyboard(event);
                }}
              >
                <rect
                  x={36 + index * step}
                  y={8}
                  width={step}
                  height={80}
                  fill="transparent"
                />
                <Bar
                  x={36 + (index + 0.2) * step}
                  width={step * 0.6}
                  ratio={h.movements / max}
                  color="motion-bar"
                />
                {index % 3 === 0 && (
                  <text
                    className="chart-label"
                    x={36 + (index + 0.5) * step}
                    y={108}
                    textAnchor="middle"
                    aria-hidden="true"
                  >
                    {String(h.hour).padStart(2, "0")}h
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}
      <p className="chart-tooltip" aria-live="polite">
        {selected === null
          ? ""
          : `${String(selected).padStart(2, "0")}:00–${String(selected).padStart(2, "0")}:59\n${data.hourlyMovements[selected].movements} movimentos`}
      </p>
    </article>
  );
}
function ActivityChart({ data }: { data: LightingAnalytics }) {
  const [selected, setSelected] = useState<number | null>(null),
    id = useId();
  const max = Math.max(
    2,
    Math.ceil(
      Math.max(...data.activity.flatMap((b) => [b.movements, b.lightOns])) / 2,
    ) * 2,
  );
  const [plotRef, width] = usePlotWidth(
    Math.max(400, 48 + data.activity.length * 16),
  );
  const step = (width - 48) / data.activity.length;
  const selectedBucket =
    selected === null
      ? null
      : data.activity.find((bucket) => bucket.bucketStart === selected);
  return (
    <article ref={plotRef} className="analytics-chart" aria-labelledby={id}>
      <div className="chart-title">
        <h3 id={id}>Movimentos e acionamentos da luz</h3>
        <HelpTooltip label="Movimentos e acionamentos da luz">
          Contagem de registros{" "}
          {data.period === "24h" || data.period === "agenda"
            ? "por hora"
            : "por dia"}
          ; os intervalos nas bordas podem ser parciais.
        </HelpTooltip>
      </div>
      <div className="chart-legend">
        <span>
          <i className="motion-key" />
          Movimentos
        </span>
        <span>
          <i className="light-key" />
          Luz acesa
        </span>
      </div>
      {data.totals.movements + data.totals.lightOns === 0 ? (
        <p className="chart-empty">
          Nenhum evento de movimento ou luz registrado.
        </p>
      ) : (
        <div
          className="chart-scroll"
          tabIndex={0}
          role="region"
          aria-label="Gráfico comparativo; pode ser rolado horizontalmente"
        >
          <svg
            viewBox={`0 0 ${width} 120`}
            className="bar-chart"
            style={{ width, minWidth: width, height: 120 }}
            role="group"
            aria-labelledby={id}
          >
            <Axes max={max} width={width} />
            {data.activity.map((b, index) => {
              const text = `${localTime(b.start, data.timezoneOffsetHours)} a ${localTime(b.end, data.timezoneOffsetHours)}: ${b.movements} movimentos; ${b.lightOns} acionamentos da luz`;
              return (
                <g
                  key={b.bucketStart}
                  data-chart-point
                  tabIndex={0}
                  role="img"
                  aria-label={text}
                  onFocus={() => setSelected(b.bucketStart)}
                  onMouseEnter={() => setSelected(b.bucketStart)}
                  onMouseLeave={() => setSelected(null)}
                  onBlur={() => setSelected(null)}
                  onClick={() => setSelected(b.bucketStart)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSelected(null);
                    else chartKeyboard(event);
                  }}
                >
                  <rect
                    x={36 + index * step}
                    y={8}
                    width={step}
                    height={80}
                    fill="transparent"
                  />
                  <Bar
                    x={38 + index * step}
                    width={Math.max(4, (step - 6) / 2)}
                    ratio={b.movements / max}
                    color="motion-bar"
                  />
                  <Bar
                    x={38 + index * step + (step - 4) / 2}
                    width={Math.max(4, (step - 6) / 2)}
                    ratio={b.lightOns / max}
                    color="light-bar"
                  />
                  {index % Math.max(1, Math.ceil(data.activity.length / 8)) ===
                    0 && (
                    <text
                      x={36 + (index + 0.5) * step}
                      y={108}
                      className="chart-label"
                      textAnchor="middle"
                      aria-hidden="true"
                    >
                      {localTime(
                        b.bucketStart,
                        data.timezoneOffsetHours,
                        data.period === "24h" || data.period === "agenda"
                          ? "time"
                          : "date",
                      )}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <p className="chart-tooltip" aria-live="polite">
        {selectedBucket
          ? `${localTime(selectedBucket.start, data.timezoneOffsetHours)}–\n${localTime(selectedBucket.end, data.timezoneOffsetHours)}\n${selectedBucket.movements} movimentos · ${selectedBucket.lightOns} acionamentos${selectedBucket.partial ? "\nIntervalo parcial" : ""}`
          : ""}
      </p>
    </article>
  );
}
function AgendaChart({ data }: { data: LightingAnalytics }) {
  const entered = useEntered(),
    distribution = data.agendaDistribution,
    id = useId();
  const total = data.totals.movements,
    inside = total && distribution ? (distribution.inside / total) * 100 : 0;
  return (
    <article className="analytics-chart agenda-chart" aria-labelledby={id}>
      <div className="chart-title">
        <h3 id={id}>Movimentos e agenda</h3>
        <HelpTooltip label="Movimentos e agenda">
          Classificação pela agenda de referência atual, sem reconstruir agendas
          históricas.
        </HelpTooltip>
      </div>
      {!distribution ? (
        <p className="chart-empty">
          Aguardando uma agenda aplicada para classificar os movimentos.
        </p>
      ) : !total ? (
        <p className="chart-empty">
          Nenhum movimento registrado para classificar.
        </p>
      ) : (
        <>
          <div className="agenda-donut">
            <svg
              viewBox="0 0 160 160"
              role="img"
              aria-label={`${distribution.inside} movimentos dentro da agenda; ${distribution.outside} fora da agenda`}
            >
              <circle cx={80} cy={80} r={58} className="donut-track" />
              <g transform="rotate(-90 80 80)">
                <circle
                  cx={80}
                  cy={80}
                  r={58}
                  pathLength={100}
                  className="donut-inside"
                  style={{ strokeDasharray: `${entered ? inside : 0} 100` }}
                />
                <circle
                  cx={80}
                  cy={80}
                  r={58}
                  pathLength={100}
                  className="donut-outside"
                  style={{
                    strokeDasharray: `${entered ? 100 - inside : 0} 100`,
                    strokeDashoffset: -inside,
                  }}
                />
              </g>
              <text x={80} y={78} className="donut-total" textAnchor="middle">
                {total}
              </text>
              <text x={80} y={98} className="donut-caption" textAnchor="middle">
                movimentos
              </text>
            </svg>
            <dl>
              <div>
                <dt>
                  <i className="light-key" />
                  Dentro da agenda
                </dt>
                <dd>
                  {distribution.inside}{" "}
                  <span>({inside.toFixed(1).replace(".", ",")}%)</span>
                </dd>
              </div>
              <div>
                <dt>
                  <i className="motion-key" />
                  Fora da agenda
                </dt>
                <dd>
                  {distribution.outside}{" "}
                  <span>({(100 - inside).toFixed(1).replace(".", ",")}%)</span>
                </dd>
              </div>
            </dl>
          </div>
        </>
      )}
    </article>
  );
}
export function LightingCharts({
  snapshot,
  connected,
  active,
  period,
  onPeriodChange,
}: {
  snapshot: Snapshot | null;
  connected: boolean;
  active: boolean;
  period: LightingPeriod;
  onPeriodChange: (period: LightingPeriod) => void;
}) {
  const { data, error, loading, refresh } = useAnalytics(
    snapshot,
    period,
    active,
    connected,
  );
  const [entrance, setEntrance] = useState(0);
  useLayoutEffect(() => {
    if (active) setEntrance((n) => n + 1);
  }, [active]);
  return (
    <section
      className="card lighting-analytics lighting-enter"
      aria-label="Análise de iluminação e movimento"
    >
      <div className="analytics-heading">
        <div>
          <p className="eyebrow">HISTÓRICO DO LEITO</p>
        </div>
        <label>
          Período
          <Select<LightingPeriod>
            label="Período dos gráficos"
            value={period}
            onValueChange={onPeriodChange}
            options={[
              { value: "24h", label: "Últimas 24 horas" },
              { value: "7d", label: "Últimos 7 dias" },
              { value: "30d", label: "Últimos 30 dias" },
              {
                value: "agenda",
                label: "Agenda do leito",
                disabled:
                  !snapshot?.device.state?.runtimeSettings &&
                  !snapshot?.appliedConfig,
              },
            ]}
          />
        </label>
      </div>
      {!snapshot ? (
        <p className="notice">
          Selecione um dispositivo para consultar seu histórico.
        </p>
      ) : (
        <>
          <div className="analytics-summary">
            <span>
              <Icon name="motion" />
              {data ? data.totals.movements : "—"} movimentos
            </span>
            <span>
              <Icon name="light-on" />
              {data ? data.totals.lightOns : "—"} acionamentos da luz
            </span>
            <button
              className="notification-detail"
              type="button"
              disabled={!connected || loading}
              onClick={refresh}
            >
              Atualizar gráficos
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              Não foi possível atualizar os gráficos.{" "}
              {data ? "A consulta anterior permanece visível. " : ""}
              {error}
            </p>
          )}
          {!connected && (
            <p className="notice">
              Sem atualização ao vivo.{" "}
              {data
                ? "Exibindo a última consulta."
                : "Os gráficos serão carregados quando a conexão retornar."}
            </p>
          )}
          {loading && connected && (
            <p className="hint" role="status">
              {data ? "Atualizando gráficos…" : "Carregando histórico…"}
            </p>
          )}
          {data && (
            <>
              <div className="analytics-context">
                <span>
                  Agenda{" "}
                  {data.agendaReference
                    ? `${data.agendaReference.startTime}–${data.agendaReference.endTime}`
                    : "indisponível"}
                  {period === "agenda" &&
                    ` · ${localTime(data.from, data.timezoneOffsetHours)}–${localTime(data.to, data.timezoneOffsetHours)}`}
                </span>{" "}
              </div>
              <div
                className="analytics-charts"
                key={`${data.deviceId}:${data.period}:${entrance}`}
              >
                <HourlyChart data={data} />
                <ActivityChart data={data} />
                <AgendaChart data={data} />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
