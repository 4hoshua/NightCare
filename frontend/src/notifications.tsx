import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, date, type Overview } from "./model";
import { Icon, type IconName } from "./navigation";

const categories = {
  presence: "Presença",
  lighting: "Iluminação",
  motion: "Movimento",
  assistance: "Assistência",
  configuration: "Configurações",
  commands: "Comandos",
  administration: "Administração",
  diagnostics: "Diagnóstico",
  system: "Sistema",
};
type Category = keyof typeof categories;
export type Notification = {
  id: number;
  type: string;
  category: Category;
  severity: "info" | "warning" | "urgent";
  title: string;
  deviceId: string | null;
  bedName: string | null;
  reference: string | null;
  occurredAt: string | null;
  receivedAt: number;
  detail: string | null;
};
type Feed = {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
  latestId: number;
  installationId: string;
};
type Toast = {
  key: string;
  title: string;
  item?: Notification;
  count?: number;
};
const icons: Record<Category, IconName> = {
  presence: "connection",
  lighting: "light",
  motion: "motion",
  assistance: "help",
  configuration: "settings",
  commands: "check",
  administration: "settings",
  diagnostics: "clock",
  system: "connection",
};
const Context = createContext<{
  overview: Overview | null;
  connected: boolean;
  unread: number;
  readThrough: number;
  markRead: (id: number) => void;
  follow: (item: Notification) => void;
  error: string;
} | null>(null);
const storageKey = (installationId: string) =>
  `nightcare.notifications.read.${installationId}`;
function storedRead(installationId: string) {
  try {
    const n = Number(localStorage.getItem(storageKey(installationId)));
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
function queryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== "") params.set(k, String(v));
  return params.toString();
}
function label(item: Notification) {
  return item.bedName ?? item.deviceId ?? "NightCare";
}

export function NotificationProvider({
  overview,
  connected,
  onSelect,
  children,
}: {
  overview: Overview | null;
  connected: boolean;
  onSelect: (deviceId: string, page?: string) => void;
  children: ReactNode;
}) {
  const meta = overview?.notifications;
  const [readState, setReadState] = useState({ installationId: "", id: 0 });
  const readThrough =
    readState.installationId === meta?.installationId
      ? readState.id
      : meta
        ? storedRead(meta.installationId)
        : 0;
  const [unread, setUnread] = useState(0),
    [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]),
    [retry, setRetry] = useState(0);
  const live = useRef<{ installationId: string; lastId: number } | null>(null);
  const wasConnected = useRef(false),
    hasConnected = useRef(false);
  const serial = useRef(0);
  function announce(incoming: Omit<Toast, "key">[]) {
    if (!incoming.length) return;
    setToasts((current) => {
      const all = [
        ...current,
        ...incoming.map((t) => ({ ...t, key: String(++serial.current) })),
      ];
      if (all.length <= 3) return all;
      const hidden = all.slice(2).reduce((n, t) => n + (t.count ?? 1), 0);
      return [
        ...all.slice(0, 2),
        {
          key: String(++serial.current),
          count: hidden,
          title: `${hidden} outros avisos. Consulte a central de notificações.`,
        },
      ];
    });
  }
  function markRead(id: number) {
    if (!meta) return;
    const value = Math.max(readThrough, id);
    setReadState({ installationId: meta.installationId, id: value });
    try {
      localStorage.setItem(storageKey(meta.installationId), String(value));
    } catch {
      /* Reading still works for this session. */
    }
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (meta && event.key === storageKey(meta.installationId))
        setReadState({
          installationId: meta.installationId,
          id: storedRead(meta.installationId),
        });
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [meta?.installationId]);
  useEffect(() => {
    if (!connected) {
      live.current = null;
      if (wasConnected.current)
        announce([
          { title: "Painel sem conexão com o backend. Tentando reconectar…" },
        ]);
    } else {
      if (hasConnected.current && !wasConnected.current)
        announce([{ title: "Conexão com o painel restabelecida" }]);
      hasConnected.current = true;
    }
    wasConnected.current = connected;
  }, [connected]);
  useEffect(() => {
    if (!connected || !meta) return;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const previous =
      live.current?.installationId === meta.installationId
        ? live.current
        : null;
    // No toasts for an initial snapshot or a reconnect backlog.
    const from = previous?.lastId ?? meta.latestId;
    void (async () => {
      const incoming: Notification[] = [];
      let cursor: string | undefined;
      let data: Feed;
      do {
        data = (await api(
          `/api/notifications?${queryString({ limit: 100, afterId: from, untilId: meta.latestId, readThroughId: readThrough, cursor })}`,
          undefined,
          controller.signal,
        )) as Feed;
        if (controller.signal.aborted) return;
        if (data.installationId !== meta.installationId) return;
        incoming.push(...data.items);
        cursor = data.nextCursor ?? undefined;
      } while (cursor);
      setUnread(data.unreadCount);
      setError("");
      live.current = {
        installationId: meta.installationId,
        lastId: meta.latestId,
      };
      announce(
        incoming
          .reverse()
          .filter((n) => n.severity !== "info")
          .map((item) => ({ title: item.title, item })),
      );
    })().catch((e) => {
      if (controller.signal.aborted) return;
      setError((e as Error).message);
      retryTimer = setTimeout(() => setRetry((n) => n + 1), 3000);
    });
    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [connected, meta?.installationId, meta?.latestId, readThrough, retry]);
  useEffect(() => {
    if (!connected || !meta) return;
    const timer = setInterval(() => setRetry((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, [connected, meta?.installationId]);
  function follow(item: Notification) {
    if (item.deviceId) {
      const device = overview?.devices.find(
        (d) => d.deviceId === item.deviceId,
      );
      const page = !device?.bed
        ? "administracao"
        : item.category === "assistance" || item.category === "commands"
          ? "assistencia"
          : item.category === "lighting" ||
              item.category === "motion" ||
              item.category === "configuration"
            ? "iluminacao"
            : "administracao";
      onSelect(item.deviceId, page);
      requestAnimationFrame(() => document.getElementById(`page-content-${item.deviceId}`)?.focus());
    } else {
      location.hash = "administracao";
    }
  }
  return (
    <Context.Provider
      value={{
        overview,
        connected,
        unread,
        readThrough,
        markRead,
        follow,
        error,
      }}
    >
      {children}
      <div
        className="notification-toasts"
        aria-label="Avisos do sistema"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toast) => (
          <NotificationToast
            key={toast.key}
            toast={toast}
            dismiss={() =>
              setToasts((items) => items.filter((t) => t.key !== toast.key))
            }
            follow={follow}
          />
        ))}
      </div>
    </Context.Provider>
  );
}

function NotificationToast({
  toast,
  dismiss,
  follow,
}: {
  toast: Toast;
  dismiss: () => void;
  follow: (item: Notification) => void;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(8000);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - started),
      );
    };
  }, [paused]);
  return (
    <div
      className={`notification-toast ${toast.item?.severity ?? "warning"}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={(e) => {
        if (!e.currentTarget.contains(document.activeElement)) setPaused(false);
      }}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (
          !e.currentTarget.contains(e.relatedTarget) &&
          !e.currentTarget.matches(":hover")
        )
          setPaused(false);
      }}
    >
      <Icon name={toast.item ? icons[toast.item.category] : "connection"} />
      <div>
        <strong>{toast.title}</strong>
        {toast.item && (
          <>
            <span>{label(toast.item)}</span>
            <button
              className="notification-detail"
              onClick={() => {
                follow(toast.item!);
                dismiss();
              }}
            >
              Ver detalhes <Icon name="arrow" />
            </button>
          </>
        )}
      </div>
      <button
        className="icon-button"
        aria-label={`Dispensar aviso: ${toast.title}`}
        onClick={dismiss}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

export function NotificationBell({ active }: { active: boolean }) {
  const context = useContext(Context)!;
  const { overview, connected, unread, readThrough, markRead, follow } =
    context;
  const [open, setOpen] = useState(false),
    [boundary, setBoundary] = useState(0);
  const [category, setCategory] = useState(""),
    [deviceId, setDeviceId] = useState("");
  const [items, setItems] = useState<Notification[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const ref = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null),
    generation = useRef(0);
  const id = useId();
  const meta = overview?.notifications;
  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }
  function update() {
    const newest = meta?.latestId ?? 0;
    setBoundary(newest);
    markRead(newest);
    setRefresh((n) => n + 1);
  }
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  useEffect(() => {
    if (!open || !active) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    const navigate = () => close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("hashchange", navigate);
    // Focus the close control without changing the page's scroll position.
    ref.current
      ?.querySelector<HTMLButtonElement>(".notification-close")
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("hashchange", navigate);
    };
  }, [open, active]);
  useEffect(() => {
    if (!open || !active || !meta || !connected) return;
    const run = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setItems([]);
    setCursor(null);
    setLoading(true);
    setError("");
    void api(
      `/api/notifications?${queryString({ category, deviceId, untilId: boundary, limit: 30 })}`,
      undefined,
      controller.signal,
    )
      .then((data: Feed) => {
        if (run !== generation.current || controller.signal.aborted) return;
        setItems(data.items);
        setCursor(data.nextCursor);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [
    open,
    active,
    connected,
    boundary,
    category,
    deviceId,
    refresh,
    meta?.installationId,
  ]);
  useEffect(() => () => request.current?.abort(), []);
  async function loadMore() {
    if (!cursor || loading) return;
    const run = generation.current;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const data = (await api(
        `/api/notifications?${queryString({ category, deviceId, untilId: boundary, limit: 30, cursor })}`,
        undefined,
        controller.signal,
      )) as Feed;
      if (run !== generation.current || controller.signal.aborted) return;
      setItems((previous) => [
        ...previous,
        ...data.items.filter((n) => !previous.some((p) => p.id === n.id)),
      ]);
      setCursor(data.nextCursor);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  return (
    <div className="notification-control" ref={ref}>
      <button
        ref={trigger}
        className={`icon-button notification-bell ${unread ? "has-unread" : ""}`}
        aria-label={`Notificações${unread ? `: ${unread} não lidas` : ""}`}
        aria-expanded={open && active}
        aria-haspopup="dialog"
        aria-controls={`${id}-panel`}
        onClick={() => {
          if (open) close();
          else {
            update();
            setOpen(true);
          }
        }}
      >
        <Icon name="help" />
        {unread > 0 && (
          <span className="notification-count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && active && (
        <section
          className="notification-panel"
          role="dialog"
          aria-labelledby={`${id}-title`}
          id={`${id}-panel`}
        >
          <div className="notification-heading">
            <div>
              <h2 id={`${id}-title`}>Notificações</h2>
              <p>Atividade de todos os leitos · últimos 30 dias</p>
            </div>
            <button
              className="icon-button notification-close"
              aria-label="Fechar notificações"
              onClick={() => close(true)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="notification-filters">
            <label>
              Dispositivo
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              >
                <option value="">Todos os dispositivos</option>
                {overview?.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.bed?.name ?? d.deviceId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Categoria
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Todas as categorias</option>
                {Object.entries(categories).map(([value, title]) => (
                  <option key={value} value={value}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="notification-actions">
            <button
              className="notification-detail"
              onClick={() => markRead(meta?.latestId ?? 0)}
            >
              Marcar todas como lidas
            </button>
            <button className="notification-detail" onClick={update}>
              Atualizar
              {(meta?.latestId ?? 0) > boundary ? " · novas notificações" : ""}
            </button>
          </div>
          {!connected && (
            <p className="notification-message" role="status">
              Sem conexão ao vivo. Exibindo o histórico já carregado.
            </p>
          )}
          {!meta && (
            <p className="notification-message">
              Central indisponível nesta versão do backend.
            </p>
          )}
          {(error || context.error) && (
            <p className="notification-message error" role="alert">
              Não foi possível atualizar as notificações.{" "}
              {error || context.error}
            </p>
          )}
          <ol className="notification-list" aria-busy={loading}>
            {items.map((item) => (
              <li
                key={item.id}
                className={`notification-item ${item.severity} ${item.id > readThrough ? "unread" : ""}`}
              >
                <span className="notification-item-icon">
                  <Icon name={icons[item.category]} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <span className="notification-device">
                    {label(item)}
                    {item.bedName && item.deviceId && (
                      <span className="mono"> · {item.deviceId}</span>
                    )}
                  </span>
                  <time dateTime={new Date(item.receivedAt).toISOString()}>
                    {date(item.receivedAt)}
                  </time>
                  {item.occurredAt && (
                    <span className="notification-occurrence">
                      No dispositivo: {date(item.occurredAt)}
                    </span>
                  )}
                  {item.detail && <p>{item.detail}</p>}
                  <button
                    className="notification-detail"
                    onClick={() => {
                      close();
                      follow(item);
                    }}
                  >
                    Ver detalhes <Icon name="arrow" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {!items.length && !loading && !error && meta && (
            <p className="notification-message">
              Nenhuma notificação para esta consulta.
            </p>
          )}
          {loading && (
            <p className="notification-message" role="status">
              Carregando notificações…
            </p>
          )}
          {cursor && (
            <button
              className="secondary notification-more"
              disabled={loading}
              onClick={() => void loadMore()}
            >
              Carregar mais
            </button>
          )}
          <p className="notification-footnote">
            Leitura salva neste navegador. Novidades são registradas enquanto o
            backend está ligado.
          </p>
        </section>
      )}
    </div>
  );
}
