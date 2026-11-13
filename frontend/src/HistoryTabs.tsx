import { useRef, type KeyboardEvent } from "react";

export function historyTabId(prefix: string, value: string) {
  return `${prefix}-${value || "all"}-tab`;
}
export function HistoryTabs({
  label,
  options,
  value,
  onChange,
  idPrefix,
  panelId,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
  panelId: (value: string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function keydown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + options.length) %
            options.length;
    onChange(options[next].value);
    ref.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }
  return (
    <div ref={ref} className="history-tabs" role="tablist" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          id={historyTabId(idPrefix, option.value)}
          aria-controls={panelId(option.value)}
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          className={value === option.value ? "" : "secondary"}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => keydown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
