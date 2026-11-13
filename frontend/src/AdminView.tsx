import type { ReactNode } from "react";
import { type Snapshot, type Overview, date } from "./model";
import { DeviceSignals } from "./DeviceSignals";
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
  demo,
}: {
  snapshot: Snapshot | null;
  connected: boolean;
  active: boolean;
  deviceContext: ReactNode;
  overview: Overview | null;
  demo: boolean | null;
}) {
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
      <section className="card lighting-state admin-state admin-enter">
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
        <div data-signal-live={live}>
          <DeviceSignals
            state={state ?? null}
            fields={["clock", "assistance"]}
            className="lighting-signals"
          />
        </div>
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
            Os indicadores e detalhes correspondem somente ao dispositivo
            selecionado no cabeçalho. O registro ao lado lista todos os
            dispositivos da instalação.
          </HelpTooltip>
        </div>
        <ObservationCharts
          snapshot={snapshot}
          active={active}
          connected={connected}
        />
        <details className="admin-detail-group">
          <summary>Configurações do dispositivo</summary>
          <ConfigurationDetails snapshot={snapshot} connected={connected} />
          <a className="text-link" href="#iluminacao">
            Editar iluminação e movimento
          </a>
        </details>
        <details className="admin-detail-group">
          <summary>Diagnóstico e implementação</summary>
          <dl className="detail-list">
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
        </details>
        {demo && (
          <p className="hint admin-disclosure">
            Broker público de testes · use somente dados fictícios.
          </p>
        )}
      </section>
    </div>
  );
}
