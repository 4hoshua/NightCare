import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
export function HelpTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0, width: 280 });
  const trigger = useRef<HTMLButtonElement>(null),
    bubble = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pinned = useRef(false),
    id = useId();
  function close() {
    clearTimeout(timer.current);
    pinned.current = false;
    setOpen(false);
  }
  function show() {
    clearTimeout(timer.current);
    setOpen(true);
  }
  function hide() {
    clearTimeout(timer.current);
    if (!pinned.current && document.activeElement !== trigger.current)
      timer.current = setTimeout(() => setOpen(false), 120);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !bubble.current?.contains(e.target as Node)
      )
        close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    const navigate = () => close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    window.addEventListener("hashchange", navigate);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("hashchange", navigate);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = trigger.current;
      if (!t || !t.getClientRects().length || t.closest("[hidden],[inert]")) {
        close();
        return;
      }
      const r = t.getBoundingClientRect(),
        v = visualViewport,
        x = v?.offsetLeft ?? 0,
        y = v?.offsetTop ?? 0,
        w = v?.width ?? innerWidth,
        h = v?.height ?? innerHeight,
        b = bubble.current?.getBoundingClientRect(),
        height = b?.height ?? 120,
        width = Math.min(300, w - 24);
      setPosition({
        width,
        left: Math.max(x + 12, Math.min(r.right - width, x + w - width - 12)),
        top: Math.max(
          y + 12,
          r.bottom + 8 + height > y + h - 12
            ? r.top - height - 8
            : r.bottom + 8,
        ),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      visualViewport?.removeEventListener("resize", place);
    };
  }, [open]);
  return (
    <span className="help-tooltip-anchor">
      <button
        ref={trigger}
        type="button"
        className="help-tooltip-trigger"
        aria-label={`Ajuda: ${label}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={close}
        onClick={() => {
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className="help-tooltip-bubble"
            style={position}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
