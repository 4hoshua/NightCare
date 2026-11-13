import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./navigation";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};
export function Select<T extends string>({
  value,
  options,
  onValueChange,
  label,
  disabled = false,
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 280,
  });
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", time: 0 });
  const id = useId();
  const selected = options.findIndex((o) => o.value === value);
  const enabled = options
    .map((o, i) => (o.disabled ? -1 : i))
    .filter((i) => i >= 0);
  function close() {
    setOpen(false);
    typed.current = { text: "", time: 0 };
  }
  function show(index = selected) {
    if (disabled || !enabled.length) return;
    document.dispatchEvent(
      new CustomEvent("nightcare:select-open", { detail: id }),
    );
    setActive(enabled.includes(index) ? index : enabled[0]);
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    trigger.current?.focus({ preventScroll: true });
    onValueChange(option.value);
  }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !trigger.current?.contains(target) &&
        !popup.current?.contains(target)
      )
        close();
    };
    const another = (event: Event) => {
      if ((event as CustomEvent).detail !== id) close();
    };
    const dismiss = () => close();
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("nightcare:select-open", another);
    document.addEventListener("nightcare:select-close", dismiss);
    window.addEventListener("hashchange", dismiss);
    window.addEventListener("popstate", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("nightcare:select-open", another);
      document.removeEventListener("nightcare:select-close", dismiss);
      window.removeEventListener("hashchange", dismiss);
      window.removeEventListener("popstate", dismiss);
    };
  }, [open, id]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = trigger.current;
      if (
        !button ||
        !button.getClientRects().length ||
        button.closest("[hidden],[inert]")
      ) {
        close();
        return;
      }
      const r = button.getBoundingClientRect(),
        viewport = window.visualViewport;
      const offsetTop = viewport?.offsetTop ?? 0,
        offsetLeft = viewport?.offsetLeft ?? 0;
      const height = viewport?.height ?? innerHeight,
        width = viewport?.width ?? innerWidth;
      const desired = Math.min(280, options.length * 42 + 12);
      const below = offsetTop + height - r.bottom - 16,
        above = r.top - offsetTop - 16;
      const upwards = below < desired && above > below;
      const maxHeight = Math.max(0, Math.min(desired, upwards ? above : below));
      const menuWidth = Math.min(Math.max(r.width, 220), width - 24);
      setPosition({
        top: upwards ? r.top - 8 - maxHeight : r.bottom + 8,
        left: Math.max(
          offsetLeft + 12,
          Math.min(r.left, offsetLeft + width - menuWidth - 12),
        ),
        width: menuWidth,
        maxHeight,
      });
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) place();
    };
    place();
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, options.length]);
  useLayoutEffect(() => {
    if (!open) return;
    const option = document.getElementById(`${id}-option-${active}`);
    if (option && popup.current) {
      const top = option.offsetTop,
        bottom = top + option.offsetHeight,
        list = popup.current;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight)
        list.scrollTop = bottom - list.clientHeight;
    }
  }, [open, active, id, position.width, position.maxHeight]);
  function keydown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Home") {
        show(enabled[0]);
        return;
      }
      if (event.key === "End") {
        show(enabled.at(-1));
        return;
      }
      if (!open) {
        show();
        return;
      }
      const at = enabled.indexOf(active),
        step = event.key === "ArrowDown" ? 1 : -1;
      setActive(enabled[(at + step + enabled.length) % enabled.length]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active);
      else show();
      return;
    }
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const normalize = (text: string) =>
        text
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase("pt-BR");
      const char = normalize(event.key),
        now = Date.now(),
        prior = now - typed.current.time < 600 ? typed.current.text : "";
      const text = prior === char ? char : prior + char;
      typed.current = { text, time: now };
      const from = prior === char ? active + 1 : 0;
      const order = [
        ...enabled.filter((i) => i >= from),
        ...enabled.filter((i) => i < from),
      ];
      const match = order.find((i) =>
        normalize(options[i].label).startsWith(text),
      );
      if (match !== undefined) {
        if (!open) show(match);
        else setActive(match);
      }
    }
  }
  const activeIndex = enabled.includes(active) ? active : enabled[0];
  return (
    <span className={`app-select ${open ? "is-open" : ""}`}>
      <button
        type="button"
        ref={trigger}
        className="app-select-trigger"
        title={options[selected]?.label}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={
          open && activeIndex !== undefined
            ? `${id}-option-${activeIndex}`
            : undefined
        }
        disabled={disabled || !enabled.length}
        onClick={() => (open ? close() : show())}
        onKeyDown={keydown}
      >
        <span>{options[selected]?.label ?? "Selecione uma opção"}</span>
        <Icon name="expand" className="app-select-chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            role="listbox"
            aria-label={label}
            id={`${id}-listbox`}
            className="app-select-menu"
            style={position}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={`app-select-option ${index === activeIndex ? "is-active" : ""} ${option.value === value ? "is-selected" : ""}`}
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <Icon name="check" />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
