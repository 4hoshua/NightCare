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
  type Overview,
} from "./model";
import { Sidebar, Icon, pages, readPage } from "./navigation";
import { DashboardView, AssistanceView, AdminView, StatusBadge } from "./views";
import { ArchiveLists, useRecords } from "./records";
import { FleetOverview, FleetAlerts, FleetAdmin, FleetApp } from "./fleet";
import { NotificationBell } from "./notifications";
import { Select } from "./Select";
import { LightingView } from "./LightingView";
import type { LightingPeriod } from "./lighting-model";
import "./style.css";
export function DeviceApp({
  deviceId,
  active,
  overview,
  connected,
  sound,
  toggleSound,
  onSelect,
  demo,
}: {
  deviceId: string;
  active: boolean;
  overview: Overview | null;
  connected: boolean;
  sound: boolean;
  toggleSound: () => void;
  onSelect: (id: string, page?: string) => void;
  demo: boolean | null;
}) {
  const snapshot = overview?.snapshots[deviceId]
    ? {
        ...overview.snapshots[deviceId],
        brokerConnected: overview.brokerConnected,
      }
    : null;
  const deviceNames = Object.fromEntries(
    (overview?.devices ?? []).map((d) => [
      d.deviceId,
      d.bed?.name ?? `Sem leito · ${d.deviceId}`,
    ]),
  );
  const [page, setPage] = useState(readPage);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!active) setMobileOpen(false);
  }, [active]);
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
    if (!active) return;
    document.title = `${pages.find((p) => p.id === page)!.label} · NightCare`;
    window.scrollTo(0, 0);
  }, [page, active]);
  const [lightingPeriod, setLightingPeriod] = useState<LightingPeriod>("24h");
  const [error, setError] = useState("");
  const [form, setForm] = useState<Settings>(defaults),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [sending, setSending] = useState(false),
    [notice, setNotice] = useState("");
  const [filter, setFilter] = useState({ type: "", from: "", to: "" });
  const [allHistory, setAllHistory] = useState(false);
  const historyQuery = (() => {
    if (!deviceId && !allHistory) return null;
    if (filter.from && filter.to && filter.from > filter.to) return null;
    const params = new URLSearchParams();
    if (allHistory) params.set("scope", "all");
    if (filter.type) params.set("type", filter.type);
    if (filter.from) params.set("from", new Date(filter.from).toISOString());
    if (filter.to) params.set("to", new Date(filter.to).toISOString());
    return params.toString();
  })();
  const historyRecords = useRecords<EventRow>(
    allHistory ? "events" : `devices/${deviceId}/events`,
    historyQuery,
    `${allHistory ? JSON.stringify(overview?.devices.map((d) => overview?.snapshots[d.deviceId]?.eventCount)) : snapshot?.eventCount}:${connected}`,
  );
  const events = historyRecords.items;
  const historyError =
    historyQuery === null
      ? deviceId || allHistory
        ? "O início deve ser anterior ao fim."
        : ""
      : historyRecords.error;
  const [now, setNow] = useState(Date.now());
  const initialized = useRef(false);
  const state = snapshot?.device.state;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!snapshot || initialized.current) return;
    const desired = snapshot.configs[0]?.payload;
    if (desired) setForm({ ...defaults, ...desired });
    initialized.current = true;
  }, [snapshot]);
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
    !!snapshot?.device.bed &&
    snapshot?.device.online &&
    state?.clockValid &&
    !sending &&
    !busy;
  const editRevision = useRef(0);
  const configFlight = useRef(false);
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
      const result = await api(`/api/devices/${deviceId}/config`, payload);
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
  async function command(selected: string) {
    if (!state?.requestId) return;
    setSending(true);
    setError("");
    try {
      await api(`/api/devices/${deviceId}/commands`, {
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
  const activeRequest = !!overview?.devices.some((d) => d.state?.requestId);
  const deviceContext = (
    <section
      className="device-context"
      aria-label="Dispositivo em acompanhamento"
    >
      <label className="bed-picker">
        Dispositivo em acompanhamento
        <Select
          label="Selecionar leito ou dispositivo"
          value={deviceId}
          onValueChange={(value) => onSelect(value)}
          options={
            overview?.devices.length
              ? overview.devices.map((d) => ({
                  value: d.deviceId,
                  label: d.bed?.name ?? `Sem leito · ${d.deviceId}`,
                }))
              : [
                  {
                    value: "",
                    label: "Aguardando dispositivos",
                    disabled: true,
                  },
                ]
          }
        />
      </label>
      <span className="mono">{deviceId || "Nenhum dispositivo"}</span>
    </section>
  );
  return (
    <div className={`app-shell ${collapsed ? "nav-collapsed" : ""}`}>
      <a
        className="skip-link"
        href={`#page-content-${deviceId}`}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById(`page-content-${deviceId}`)?.focus();
        }}
      >
        Pular para o conteúdo
      </a>
      <Sidebar
        navigationId={`primary-navigation-${deviceId}`}
        triggerId={`menu-toggle-${deviceId}`}
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
              id={`menu-toggle-${deviceId}`}
              className="icon-button menu-toggle"
              aria-label="Abrir menu"
              aria-expanded={mobileOpen}
              aria-controls={`primary-navigation-${deviceId}`}
              onClick={() => setMobileOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb">
              <strong>{currentPage.label}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <NotificationBell active={active} />
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
        <main id={`page-content-${deviceId}`} tabIndex={-1}>
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
              <StatusBadge online={page === "dashboard" ? connected : online}>
                {page === "dashboard"
                  ? connected
                    ? "Painel conectado"
                    : "Aguardando conexão"
                  : online
                    ? "Ambiente conectado"
                    : "Aguardando conexão"}
              </StatusBadge>
              <span>
                {page === "dashboard"
                  ? `${connected ? (overview?.devices.filter((d) => d.online).length ?? 0) : 0} de ${overview?.devices.length ?? 0} dispositivos online`
                  : `Última comunicação: ${date(snapshot?.device.lastSeen ?? null)}`}
              </span>
            </div>
          </div>
          {page !== "dashboard" && page !== "iluminacao" && deviceContext}
          <FleetAlerts
            overview={overview}
            connected={connected}
            onSelect={onSelect}
          />
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
          {page === "dashboard" && (
            <FleetOverview
              overview={overview}
              connected={connected}
              onSelect={onSelect}
            />
          )}
          {page === "iluminacao" && (
            <LightingView
              deviceContext={deviceContext}
              snapshot={snapshot}
              connected={connected}
              form={form}
              dirty={dirty}
              saving={saving}
              change={change}
              save={save}
              active={active}
              period={lightingPeriod}
              onPeriodChange={setLightingPeriod}
              canConfigure={!!snapshot?.device.bed}
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
            <FleetAdmin overview={overview} connected={connected} />
            <label className="history-scope">
              Históricos
              <Select
                label="Abrangência do histórico"
                value={allHistory ? "all" : "selected"}
                onValueChange={(value) => setAllHistory(value === "all")}
                options={[
                  { value: "selected", label: "Dispositivo selecionado" },
                  { value: "all", label: "Todos os dispositivos" },
                ]}
              />
            </label>
            <AdminView
              snapshot={snapshot}
              connected={connected}
              events={events}
              filter={filter}
              setFilter={setFilter}
              historyError={historyError}
              demo={demo}
              historyRecords={historyRecords}
              deviceNames={deviceNames}
            />
            <ArchiveLists
              snapshot={snapshot}
              connected={connected}
              scope={allHistory ? "all" : deviceId}
              deviceNames={deviceNames}
              revision={
                allHistory ? JSON.stringify(overview?.snapshots) : undefined
              }
            />
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
createRoot(document.getElementById("root")!).render(
  <FleetApp renderDevice={(props) => <DeviceApp {...props} />} />,
);
