import { useEffect, useRef } from "react";

export type Page = "dashboard" | "iluminacao" | "assistencia" | "administracao";
export const pages: {
  id: Page;
  label: string;
  icon: IconName;
  title: string;
  description: string;
}[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    title: "Uma noite mais tranquila.",
    description:
      "Tudo o que importa para acompanhar o ambiente, em um só lugar.",
  },
  {
    id: "iluminacao",
    label: "Iluminação e movimento",
    icon: "light",
    title: "Luz no momento certo.",
    description: "Acompanhe o movimento e ajuste a iluminação para cada noite.",
  },
  {
    id: "assistencia",
    label: "Assistência",
    icon: "help",
    title: "Presença quando importa.",
    description:
      "Acompanhe cada pedido de ajuda, do primeiro sinal ao atendimento.",
  },
  {
    id: "administracao",
    label: "Administração",
    icon: "settings",
    title: "O ambiente, em detalhe.",
    description:
      "Consulte as configurações e acompanhe o histórico de atividades.",
  },
];
export function readPage(): Page {
  const hash = location.hash.slice(1);
  return pages.find((p) => p.id === hash)?.id ?? "dashboard";
}
export type IconName =
  | "dashboard"
  | "light"
  | "help"
  | "settings"
  | "motion"
  | "arrow"
  | "menu"
  | "close"
  | "collapse"
  | "expand"
  | "sound"
  | "muted"
  | "connection"
  | "clock"
  | "check"
  | "moon";
const paths: Record<IconName, string> = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  light: "M9 18h6 M10 21h4 M8 14a6 6 0 1 1 8 0c-1.2 1-1 2-1 2H9s.2-1-1-2Z",
  help: "M12 3a8 8 0 0 0-8 8v5h16v-5a8 8 0 0 0-8-8Z M2 16h20 M9 20h6 M12 1v2",
  settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  motion: "M3 12h4l3-8 4 16 3-8h4",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "M6 6l12 12 M6 18 18 6",
  collapse: "M14 6l-6 6 6 6",
  expand: "M10 6l6 6-6 6",
  sound: "M11 4 6 8H3v8h3l5 4V4Z M15 8a6 6 0 0 1 0 8 M18 4a11 11 0 0 1 0 16",
  muted: "M11 4 6 8H3v8h3l5 4V4Z M16 9l6 6 M16 15l6-6",
  connection:
    "M3 8a14 14 0 0 1 18 0 M6 12a9 9 0 0 1 12 0 M9 16a4 4 0 0 1 6 0 M12 20h.01",
  clock: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  check: "M5 12l4 4L19 6",
  moon: "M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z",
};
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Sidebar({
  page,
  collapsed,
  onCollapse,
  mobileOpen,
  onClose,
  activeRequest,
}: {
  page: Page;
  collapsed: boolean;
  onCollapse: () => void;
  mobileOpen: boolean;
  onClose: () => void;
  activeRequest: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    function keydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab") return;
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLElement>("a,button") ?? [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [mobileOpen, onClose]);
  return (
    <>
      {mobileOpen && (
        <button
          className="menu-backdrop"
          aria-label="Fechar menu de navegação"
          onClick={onClose}
          tabIndex={-1}
        />
      )}
      <aside
        ref={ref}
        className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}
        aria-label="Navegação NightCare"
        {...(mobileOpen ? { role: "dialog", "aria-modal": true } : {})}
      >
        <a
          className="brand"
          href="#dashboard"
          aria-label="NightCare — Dashboard"
          onClick={onClose}
        >
          <span className="brand-symbol">
            <Icon name="moon" />
          </span>
          <span className="brand-name">
            NightCare<span>Cuidado que acompanha.</span>
          </span>
        </a>
        <button
          className="icon-button mobile-close"
          onClick={onClose}
          aria-label="Fechar menu"
        >
          <Icon name="close" />
        </button>
        <div className="nav-heading">SEU AMBIENTE</div>
        <nav id="primary-navigation" aria-label="Principal">
          {pages.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`nav-item ${page === item.id ? "selected" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
              onClick={onClose}
            >
              <Icon name={item.icon} />
              <span className="nav-label">{item.label}</span>
              {item.id === "assistencia" && activeRequest && (
                <span className="nav-dot" aria-label="Chamado ativo" />
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="moon" />
            <p>
              Mais autonomia.
              <br />
              <strong>Mais tranquilidade.</strong>
            </p>
          </div>
          <button
            className="collapse-button"
            onClick={onCollapse}
            aria-label={collapsed ? "Expandir navegação" : "Recolher navegação"}
            aria-expanded={!collapsed}
            aria-controls="primary-navigation"
          >
            <Icon name={collapsed ? "expand" : "collapse"} />
            <span>Recolher menu</span>
          </button>
        </div>
      </aside>
    </>
  );
}
