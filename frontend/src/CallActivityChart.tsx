import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { AssistanceAnalytics } from "./assistance-model";

export function CallActivityChart({ data }: { data: AssistanceAnalytics }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState(0);
  const touchSelection = useRef(false);
  const points = data.callActivity;
  const hourly = data.period === "24h" || data.period === "agenda";
  const step = hourly ? 3600000 : 86400000;
  const bucketKey = (start: number) =>
    Math.floor((start + data.timezoneOffsetHours * 3600000) / step);
  const selectionKey = `${data.deviceId}:${data.period}:${points.map((p) => bucketKey(p.start)).join(",")}`;
  useEffect(() => {
    setSelected(null);
    setFocused(0);
    touchSelection.current = false;
  }, [selectionKey]);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => {
      if (node.clientWidth) setWidth(Math.max(160, node.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (selected === null) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        touchSelection.current = false;
        setSelected(null);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [selected]);
  const local = (at: number, axis = false) =>
    new Date(at + data.timezoneOffsetHours * 3600000).toLocaleString("pt-BR", {
      timeZone: "UTC",
      ...(axis
        ? hourly
          ? { hour: "2-digit", minute: "2-digit" }
          : { day: "2-digit", month: "2-digit" }
        : {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }),
    });
  const describe = (index: number) => {
    const point = points[index];
    return `${local(point.start)}–${local(point.end)}: ${point.count} ${point.count === 1 ? "chamado" : "chamados"}${point.partial ? " · intervalo parcial" : ""}`;
  };
  function keyboard(event: KeyboardEvent<SVGGElement>, index: number) {
    touchSelection.current = false;
    if (event.key === "Escape") {
      event.preventDefault();
      setSelected(null);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(index);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? points.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + points.length) %
            points.length;
    root.current
      ?.querySelectorAll<SVGGElement>("[data-call-point]")
      [next]?.focus();
  }
  const max = Math.max(1, ...points.map((p) => p.count));
  const left = Math.max(30, String(max).length * 6 + 10),
    right = width - 12,
    top = 12,
    bottom = 125;
  const timeX = (at: number) =>
    left +
    ((at - data.from) / Math.max(1, data.to - data.from)) * (right - left);
  const x = (index: number) =>
    timeX((points[index].start + points[index].end) / 2);
  const y = (value: number) => bottom - (value / max) * (bottom - top);
  const ticks = [...new Set([0, Math.ceil(max / 2), max])];
  const labelCount = width < 260 ? 3 : 5;
  const labels = new Set(
    Array.from({ length: labelCount }, (_, i) =>
      Math.round((i * (points.length - 1)) / (labelCount - 1)),
    ),
  );
  const current = selected !== null && points[selected] ? selected : null;
  const offsetLabel = `UTC${data.timezoneOffsetHours >= 0 ? "+" : ""}${data.timezoneOffsetHours}`;
  return (
    <div ref={root} className="call-activity-plot">
      <svg
        viewBox={`0 0 ${width} 160`}
        width="100%"
        height="160"
        role="group"
        aria-label={`Chamados por ${hourly ? "hora" : "dia"}, ${offsetLabel}`}
      >
        <g className="chart-axis" aria-hidden="true">
          {ticks.map((value) => (
            <g key={value}>
              <line x1={left} x2={right} y1={y(value)} y2={y(value)} />
              <text x={left - 6} y={y(value) + 3} textAnchor="end">
                {value}
              </text>
            </g>
          ))}
          {points.map(
            (p, i) =>
              labels.has(i) && (
                <text
                  key={p.start}
                  x={x(i)}
                  y="147"
                  textAnchor={
                    i === 0
                      ? "start"
                      : i === points.length - 1
                        ? "end"
                        : "middle"
                  }
                >
                  {local(p.start, true)}
                </text>
              ),
          )}
        </g>
        {points.map((p, i) => (
          <g
            key={bucketKey(p.start)}
            data-call-point={i}
            role="button"
            tabIndex={focused === i ? 0 : -1}
            aria-label={describe(i)}
            aria-pressed={current === i}
            onFocus={() => {
              setFocused(i);
              setSelected(i);
            }}
            onBlur={() => {
              if (!touchSelection.current) setSelected(null);
            }}
            onKeyDown={(e) => keyboard(e, i)}
            onPointerDown={(e) => {
              touchSelection.current = e.pointerType !== "mouse";
              setSelected(i);
            }}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") {
                touchSelection.current = false;
                setSelected(i);
              }
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse" && !touchSelection.current)
                setSelected(null);
            }}
            onClick={() => setSelected(i)}
          >
            <rect
              x={timeX(p.start)}
              y={top - 8}
              width={Math.max(1, timeX(p.end) - timeX(p.start))}
              height={bottom - top + 16}
              fill="transparent"
            />
            <circle
              className={`call-activity-point ${p.count === 0 ? "is-zero" : ""} ${current === i ? "is-selected" : ""}`}
              cx={x(i)}
              cy={y(p.count)}
              r={current === i ? 5 : 3.5}
            />
          </g>
        ))}
      </svg>
      <p className="chart-tooltip" role="status" aria-live="polite">
        {current !== null ? `${describe(current)} · ${offsetLabel}` : ""}
      </p>
    </div>
  );
}
