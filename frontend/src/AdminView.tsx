import {
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { type Snapshot, type Overview, date } from "./model";
import { FleetAdmin } from "./fleet";
import { HelpTooltip } from "./HelpTooltip";
import { ConfigurationDetails } from "./views";
import { ObservationCharts } from "./ObservationCharts";
export function AdminView({
  snapshot,
  connected,
  active,
  deviceContext,
  overview,
}: {
  snapshot: Snapshot | null;
  connected: boolean;
  active: boolean;
  deviceContext: ReactNode;
  overview: Overview | null;
}) {
  const [tab, setTab] = useState<"configuration" | "diagnostics">(
    "configuration",
  );
  const tabId = useId();
  const tabs = useRef<HTMLDivElement>(null);
  function tabKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    setTab(next === 0 ? "configuration" : "diagnostics");
    tabs.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }
  const state = snapshot?.device.state,
    live =
      connected && !!snapshot?.brokerConnected && !!snapshot?.device.online;
  const diagnostics: [string, string | number][] = [
    ["Dispositivo", snapshot?.device.deviceId ?? "—"],
    [
      "Comunicação MQTT",
      connected
        ? snapshot?.brokerConnected
          ? "Conectada"
          : "Desconectada"
        : "Sem atualização",
    ],
    ["Atualizações WebSocket", connected ? "Conectadas" : "Desconectadas"],
    ["Última comunicação", date(snapshot?.device.lastSeen ?? null)],
    ["Inicialização (boot)", state?.bootId ?? "—"],
    [
      "Tempo em execução no último estado",
      state ? `${Math.floor(state.uptimeMs / 1000)} s` : "—",
    ],
    ["Sequência do estado", state?.sequence ?? "—"],
    [
      "Persistência no dispositivo",
      state
        ? state.persistenceOk
          ? "Operacional"
          : "Falha"
        : "Sem informação",
    ],
    [
      "Relógio",
      state
        ? state.clockValid
          ? "Sincronizado"
          : "Inválido ou em teste"
        : "Sem informação",
    ],
    ["Eventos descartados", state?.droppedEvents ?? "—"],
    ["Acionamentos do botão AJUDA", state?.pressCount ?? "—"],
    ["Identificador do chamado", state?.requestId ?? "—"],
  ];
  return (
    <div className={`admin-page ${active ? "is-active" : ""}`}>
      <section className="card admin-state admin-enter">
        <div>
          <p className="eyebrow">ESTADO DO DISPOSITIVO</p>
          <h2>
            {!snapshot
              ? "Aguardando dispositivos"
              : live
                ? "Dispositivo em acompanhamento."
                : "Aguardando comunicação ao vivo."}
          </h2>
        </div>
        {deviceContext}
      </section>
      <div className="admin-registration admin-enter">
        <FleetAdmin overview={overview} connected={connected} />
      </div>
      <section className="card admin-information admin-enter">
        <div className="section-title">
          <div>
            <p className="eyebrow">INFORMAÇÕES DETALHADAS</p>
            <h2>Dispositivo e observabilidade</h2>
          </div>
          <HelpTooltip label="Informações detalhadas">
            Os indicadores correspondem somente ao dispositivo selecionado no
            cabeçalho. O registro ao lado lista todos os dispositivos da
            instalação.
          </HelpTooltip>
        </div>
        <div
          className="admin-observation-scroll"
          tabIndex={0}
          role="region"
          aria-label="Indicadores de observabilidade"
        >
          <ObservationCharts
            snapshot={snapshot}
            active={active}
            connected={connected}
          />
        </div>
      </section>
      <section className="card admin-technical admin-enter">
        <div className="section-title">
          <div>
            <p className="eyebrow">INFORMAÇÕES DO DISPOSITIVO</p>
            <h2>Configurações e diagnóstico</h2>
          </div>
        </div>
        <div
          className="admin-technical-tabs"
          ref={tabs}
          role="tablist"
          aria-label="Detalhes do dispositivo"
        >
          {(
            [
              ["configuration", "Configurações"],
              ["diagnostics", "Diagnóstico"],
            ] as const
          ).map(([value, label], index) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${tabId}-${value}-tab`}
              aria-controls={`${tabId}-${value}-panel`}
              aria-selected={tab === value}
              tabIndex={tab === value ? 0 : -1}
              className={tab === value ? "" : "secondary"}
              onClick={() => setTab(value)}
              onKeyDown={(event) => tabKeyboard(event, index)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="admin-technical-panel"
          role="tabpanel"
          id={`${tabId}-configuration-panel`}
          aria-labelledby={`${tabId}-configuration-tab`}
          hidden={tab !== "configuration"}
          tabIndex={0}
        >
          <ConfigurationDetails snapshot={snapshot} connected={connected} />
          <a className="text-link" href="#iluminacao">
            Editar iluminação e movimento
          </a>
        </div>
        <div
          className="admin-technical-panel"
          role="tabpanel"
          id={`${tabId}-diagnostics-panel`}
          aria-labelledby={`${tabId}-diagnostics-tab`}
          hidden={tab !== "diagnostics"}
          tabIndex={0}
        >
          <dl className="detail-list admin-diagnostics">
            {diagnostics.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="hint">
            Presença expira após 45 segundos sem estado novo. O uptime
            corresponde ao último estado recebido; perdas são contadas em RAM e
            reiniciam com o dispositivo.
          </p>
        </div>
      </section>
    </div>
  );
}
