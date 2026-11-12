import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  defaults,
  api,
  newId,
  date,
  type Settings,
  type Snapshot,
  type EventRow,
} from "./model";
import { Sidebar, Icon, pages, readPage } from "./navigation";
import {
  DashboardView,
  LightingView,
  AssistanceView,
  AdminView,
  StatusBadge,
} from "./views";
import { ArchiveLists, useRecords } from "./records";
import "./style.css";
function App() {
  const [page, setPage] = useState(readPage);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMenu = useCallback(() => setMobileOpen(false), []);
  useEffect(() => {
    const navigate = () => {
      const current = readPage();
      if (location.hash !== `#${current}`)
        history.replaceState(null, "", `#${current}`);
      setPage(current);
      setMobileOpen(false);
    };
    navigate();
    window.addEventListener("hashchange", navigate);
    const desktop = matchMedia("(min-width: 801px)");
    const resize = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", resize);
    return () => {
      window.removeEventListener("hashchange", navigate);
      desktop.removeEventListener("change", resize);
    };
  }, []);
  useEffect(() => {
    document.title = `${pages.find((p) => p.id === page)!.label} · NightCare`;
    window.scrollTo(0, 0);
  }, [page]);
  const [demo, setDemo] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [connected, setConnected] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState<Settings>(defaults),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [sending, setSending] = useState(false),
    [notice, setNotice] = useState("");
  const [filter, setFilter] = useState({ type: "", from: "", to: "" });
  const historyQuery = (() => {
    if (filter.from && filter.to && filter.from > filter.to) return null;
    const params = new URLSearchParams();
    if (filter.type) params.set("type", filter.type);
    if (filter.from) params.set("from", new Date(filter.from).toISOString());
    if (filter.to) params.set("to", new Date(filter.to).toISOString());
    return params.toString();
  })();
  const historyRecords = useRecords<EventRow>(
    "events",
    historyQuery,
    `${snapshot?.eventCount}:${connected}`,
  );
  const events = historyRecords.items;
  const historyError =
    historyQuery === null
      ? "O início deve ser anterior ao fim."
      : historyRecords.error;
  const [sound, setSound] = useState(false),
    [now, setNow] = useState(Date.now());
  const audio = useRef<AudioContext | null>(null),
    statusRef = useRef(false),
    initialized = useRef(false);
  const state = snapshot?.device.state;
  useEffect(() => {
    fetch("/ui-config")
      .then((r) => r.json())
      .then((v) => setDemo(v.demo))
      .catch(() => setError("Não foi possível conectar ao backend."));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let active = true,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined;
    function connect() {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data);
          if (message.type === "snapshot" && active) {
            setSnapshot(message.data);
            setConnected(true);
            setError("");
          }
        } catch {
          setError("Resposta inválida do painel.");
        }
      };
      socket.onclose = (e) => {
        if (!active) return;
        setConnected(false);
        retry = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    }
    connect();
    return () => {
      active = false;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
  useEffect(() => {
    if (!snapshot || initialized.current) return;
    const desired = snapshot.configs[0]?.payload;
    if (desired) setForm({ ...defaults, ...desired });
    initialized.current = true;
  }, [snapshot]);
  statusRef.current = !!connected && state?.assistanceStatus === "PENDING";
  useEffect(() => {
    if (!sound) return;
    const beep = () => {
      const ctx = audio.current;
      if (!statusRef.current || !ctx || ctx.state !== "running") return;
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    };
    beep();
    const t = setInterval(beep, 5000);
    return () => clearInterval(t);
  }, [sound]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function toggleSound() {
    if (sound) {
      setSound(false);
      return;
    }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setSound(true);
    } catch {
      setError("O navegador não permitiu o áudio.");
    }
  }
  const request =
    snapshot?.activeRequest ??
    snapshot?.requests.find((r) => r.request_id === state?.requestId);
  const wait = request?.opened_at
    ? Math.max(0, Math.floor((now - request.opened_at) / 1000))
    : null;
  const action =
    state?.assistanceStatus === "PENDING" ? "ACK_HELP" : "CLOSE_HELP";
  const busy = snapshot?.commands.some(
    (c) =>
      c.request_id === state?.requestId &&
      c.action === action &&
      (c.status === "PENDING" || c.status === "UNCONFIRMED") &&
      c.expires_at > now,
  );
  const canAct =
    connected &&
    snapshot?.device.online &&
    state?.clockValid &&
    !sending &&
    !busy;
  const editRevision = useRef(0);
  const configFlight = useRef(false);
  const desiredRef = useRef<Settings | null>(null);
  useEffect(() => {
    desiredRef.current = snapshot?.configs[0]?.payload ?? null;
  }, [snapshot?.configs[0]?.config_version]);
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    editRevision.current++;
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (configFlight.current) return;
    configFlight.current = true;
    const revision = editRevision.current;
    setSaving(true);
    setError("");
    try {
      const payload = {
        mode: form.mode,
        brightnessPct: form.brightnessPct,
        offDelaySec: form.offDelaySec,
        startTime: form.startTime,
        endTime: form.endTime,
        timezone: form.timezone,
      };
      const result = await api("/api/config", payload);
      desiredRef.current = payload;
      if (revision === editRevision.current) setDirty(false);
      setNotice(
        `Versão ${result.configVersion} enviada. Aguarde confirmação do ESP32.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      configFlight.current = false;
      setSaving(false);
    }
  }
  async function quickMode(mode: Settings["mode"]) {
    if (configFlight.current || !connected) return;
    configFlight.current = true;
    setSaving(true);
    setError("");
    // Use the latest persisted intent, never the unsent draft.
    const latest = desiredRef.current ?? snapshot?.configs[0]?.payload;
    const base = latest ?? defaults;
    const payload: Settings = {
      mode,
      brightnessPct: base.brightnessPct,
      offDelaySec: base.offDelaySec,
      startTime: base.startTime,
      endTime: base.endTime,
      timezone: base.timezone,
    };
    try {
      const result = await api("/api/config", payload);
      desiredRef.current = payload;
      setForm((f) => ({ ...f, mode }));
      setNotice(
        `Modo enviado na versão ${result.configVersion}. Aguarde confirmação do ESP32.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      configFlight.current = false;
      setSaving(false);
    }
  }
  async function command(selected: string) {
    if (!state?.requestId) return;
    setSending(true);
    setError("");
    try {
      await api("/api/commands", {
        commandId: newId(),
        requestId: state.requestId,
        action: selected,
      });
      setNotice("Comando enviado. Aguarde a confirmação do dispositivo.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const currentPage = pages.find((p) => p.id === page)!;
  const online = connected && !!snapshot?.device.online;
  const activeRequest = !!state?.requestId;
  return (
    <div className={`app-shell ${collapsed ? "nav-collapsed" : ""}`}>
      <a
        className="skip-link"
        href="#page-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("page-content")?.focus();
        }}
      >
        Pular para o conteúdo
      </a>
      <Sidebar
        page={page}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onClose={closeMenu}
        activeRequest={activeRequest}
      />
      <div className="app-body" inert={mobileOpen}>
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button menu-toggle"
              aria-label="Abrir menu"
              aria-expanded={mobileOpen}
              aria-controls="primary-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb">
              Seu ambiente<span>/</span>
              <strong>{currentPage.label}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <a
              className={`help-indicator ${activeRequest ? "active" : ""}`}
              href="#assistencia"
              aria-label={
                activeRequest
                  ? "Chamado ativo — abrir Assistência"
                  : "Abrir Assistência"
              }
            >
              <Icon name="help" />
              {activeRequest && <span className="indicator-dot" />}
            </a>
            <span className="topbar-divider" />
            <button
              className={`sound-button ${sound ? "enabled" : ""}`}
              onClick={toggleSound}
              aria-pressed={sound}
              aria-label={
                sound ? "Desativar aviso sonoro" : "Ativar aviso sonoro"
              }
              title={sound ? "Desativar aviso sonoro" : "Ativar aviso sonoro"}
            >
              <Icon name={sound ? "sound" : "muted"} />
              <span>{sound ? "Som ativado" : "Ativar som"}</span>
            </button>
          </div>
        </header>
        <main id="page-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {page === "dashboard"
                  ? "VISÃO GERAL"
                  : currentPage.label.toLocaleUpperCase("pt-BR")}
              </p>
              <h1>{currentPage.title}</h1>
              <p>{currentPage.description}</p>
            </div>
            <div className="environment-status">
              <StatusBadge online={online}>
                {online ? "Ambiente conectado" : "Aguardando conexão"}
              </StatusBadge>
              <span>
                Última comunicação: {date(snapshot?.device.lastSeen ?? null)}
              </span>
            </div>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && (
            <div role="status" className="notice dismissible">
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dispensar mensagem"
                onClick={() => setNotice("")}
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          {!connected && (
            <p role="alert" className="notice">
              {demo === null
                ? "Conectando ao ambiente…"
                : "Painel sem atualização ao vivo. Os valores exibidos correspondem à última informação recebida."}
            </p>
          )}
          {activeRequest && page !== "assistencia" && (
            <a className="assistance-banner" href="#assistencia">
              <span className="banner-icon">
                <Icon name="help" />
              </span>
              <div>
                <strong>
                  {state?.assistanceStatus === "PENDING"
                    ? "Um pedido de ajuda precisa de atenção."
                    : "Há um atendimento em andamento."}
                </strong>
                <span>
                  {online
                    ? "Acompanhe o chamado e confirme as ações na tela de Assistência."
                    : "Último chamado conhecido. Aguarde a reconexão para confirmar novas ações."}
                </span>
              </div>
              <Icon name="arrow" />
            </a>
          )}
          {page === "dashboard" && (
            <DashboardView snapshot={snapshot} connected={connected} />
          )}
          {page === "iluminacao" && (
            <LightingView
              snapshot={snapshot}
              connected={connected}
              form={form}
              dirty={dirty}
              saving={saving}
              change={change}
              save={save}
              quickMode={quickMode}
            />
          )}
          {page === "assistencia" && (
            <AssistanceView
              snapshot={snapshot}
              connected={connected}
              wait={wait}
              canAct={!!canAct}
              busy={!!busy}
              command={command}
            />
          )}
          <div hidden={page !== "administracao"}>
            <AdminView
              snapshot={snapshot}
              connected={connected}
              events={events}
              filter={filter}
              setFilter={setFilter}
              historyError={historyError}
              demo={demo}
              historyRecords={historyRecords}
            />
            <ArchiveLists snapshot={snapshot} connected={connected} />
          </div>
          <footer>
            <span className="footer-brand">NightCare</span>
            <span>
              Apoio ao deslocamento noturno{" "}
              <span className="footer-separator">·</span> Avisos remotos
              dependem da conexão e do painel aberto.
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
