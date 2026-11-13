import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Select } from "./Select";
import { Icon } from "./navigation";
const hours = Array.from({ length: 24 }, (_, n) => ({
  value: String(n).padStart(2, "0"),
  label: String(n).padStart(2, "0"),
}));
const minutes = Array.from({ length: 60 }, (_, n) => ({
  value: String(n).padStart(2, "0"),
  label: String(n).padStart(2, "0"),
}));
export function TimePicker({
  label,
  value,
  onChange,
  active,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  active: boolean;
}) {
  const [open, setOpen] = useState(false),
    [hour, setHour] = useState("00"),
    [minute, setMinute] = useState("00");
  const [position, setPosition] = useState({ top: 0, left: 0, width: 300 });
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    id = useId();
  function close(returnFocus = false) {
    document.dispatchEvent(new Event("nightcare:select-close"));
    setOpen(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }
  function show() {
    document.dispatchEvent(
      new CustomEvent("nightcare:time-open", { detail: id }),
    );
    setHour(value.slice(0, 2));
    setMinute(value.slice(3, 5));
    setOpen(true);
  }
  useEffect(() => {
    if (!active && open) close();
  }, [active]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !panel.current?.contains(e.target as Node)
      )
        close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close(true);
      }
    };
    const other = (e: Event) => {
      if ((e as CustomEvent).detail !== id) close();
    };
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target === document.body) return;
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target) &&
        !target.closest(".app-select-menu")
      )
        close();
    };
    const navigate = () => close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    document.addEventListener("keydown", key);
    document.addEventListener("nightcare:time-open", other);
    window.addEventListener("hashchange", navigate);
    panel.current
      ?.querySelector<HTMLButtonElement>('[role="combobox"]')
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", focusOutside);
      document.removeEventListener("keydown", key);
      document.removeEventListener("nightcare:time-open", other);
      window.removeEventListener("hashchange", navigate);
      document.dispatchEvent(new Event("nightcare:select-close"));
    };
  }, [open, id]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = trigger.current;
      if (!t || !t.getClientRects().length) {
        close();
        return;
      }
      const r = t.getBoundingClientRect(),
        p = panel.current?.getBoundingClientRect(),
        vv = visualViewport;
      const w = vv?.width ?? innerWidth,
        h = vv?.height ?? innerHeight,
        x = vv?.offsetLeft ?? 0,
        y = vv?.offsetTop ?? 0;
      const width = Math.min(320, w - 24),
        height = p?.height ?? 240;
      setPosition({
        width,
        left: Math.max(x + 12, Math.min(r.left, x + w - width - 12)),
        top: Math.max(
          y + 12,
          r.bottom + 8 + height > y + h - 12
            ? r.top - height - 8
            : r.bottom + 8,
        ),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      visualViewport?.removeEventListener("resize", place);
    };
  }, [open]);
  return (
    <span className="time-picker">
      <button
        ref={trigger}
        type="button"
        className="time-picker-trigger"
        aria-label={`${label}: ${value}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => (open ? close() : show())}
      >
        <span>{value}</span>
        <Icon name="clock" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={label}
            id={`${id}-panel`}
            className="time-picker-panel"
            style={position}
          >
            <div className="time-picker-title">
              <strong>{label}</strong>
              <span>Formato 24 horas</span>
            </div>
            <div className="time-picker-fields">
              <label>
                Hora
                <Select
                  label={`Hora de ${label}`}
                  value={hour}
                  options={hours}
                  onValueChange={setHour}
                />
              </label>
              <span aria-hidden="true">:</span>
              <label>
                Minuto
                <Select
                  label={`Minuto de ${label}`}
                  value={minute}
                  options={minutes}
                  onValueChange={setMinute}
                />
              </label>
            </div>
            <div className="time-picker-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => close(true)}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(`${hour}:${minute}`);
                  close(true);
                }}
              >
                Definir horário
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
