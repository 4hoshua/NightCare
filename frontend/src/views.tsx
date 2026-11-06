import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  date,
  eventNames,
  names,
  type Settings,
  type Snapshot,
  type EventRow,
} from "./model";
import { Icon, type IconName } from "./navigation";

type LiveProps = { snapshot: Snapshot | null; connected: boolean };
export type HistoryFilter = { type: string; from: string; to: string };
export function StatusBadge({
  online,
  children,
}: {
  online?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`status-badge ${online ? "positive" : "neutral"}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: IconName;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="metric">
      <span className={`metric-icon ${icon}`}>
        <Icon name={icon} />
      </span>
      <div>
        <p className="metric-label">{label}</p>
        <strong>{value}</strong>
        <span className="metric-detail">{detail}</span>
      </div>
    </article>
  );
}
function Freshness({ snapshot, connected }: LiveProps) {
  const live = connected && snapshot?.device.online;
  return (
    <p className={`freshness ${live ? "live" : ""}`}>
      <span className="status-dot" />
      {!snapshot?.device.state
        ? "Aguardando o primeiro estado do dispositivo"
        : live
          ? "Estado recebido do dispositivo"
          : "Último estado recebido · sem atualização ao vivo"}
    </p>
  );
}
export function LiveMetrics({ snapshot, connected }: LiveProps) {
  const state = snapshot?.device.state,
    online = connected && snapshot?.device.online;
  return (
    <section className="metrics" aria-label="Estado do ambiente">
      <Metric
        icon="connection"
        label="Ambiente"
        value={
          !snapshot ? "Aguardando dados" : online ? "Conectado" : "Sem conexão"
        }
        detail={
          online
            ? "Acompanhamento em tempo real"
            : "Aguardando atualização do dispositivo"
        }
      />
      <Metric
        icon="light"
        label="Iluminação"
        value={state ? (state.lightOn ? "Acesa" : "Apagada") : "Sem informação"}
        detail={
          state
            ? `${state.brightnessPct}% de brilho · ${names[state.mode]}`
            : "Aguardando primeiro estado"
        }
      />
      <Metric
        icon="motion"
        label="Movimento"
        value={
          state
            ? state.motion
              ? "Detectado"
              : "Sem movimento"
            : "Sem informação"
        }
        detail="Sensor de presença do ambiente"
      />
      <Metric
        icon="help"
        label="Assistência"
        value={
          state
            ? state.assistanceStatus === "PENDING"
              ? "Ajuda solicitada"
              : names[state.assistanceStatus]
            : "Sem informação"
        }
        detail={
          state?.requestId
            ? "Acompanhe na tela de Assistência"
            : "Botão de ajuda sempre disponível"
        }
      />
    </section>
  );
}
function ConfigValues({ settings }: { settings: Settings }) {
  return (
    <dl className="config-values">
      <div>
        <dt>Modo</dt>
        <dd>{names[settings.mode]}</dd>
      </div>
      <div>
        <dt>Brilho</dt>
        <dd>{settings.brightnessPct}%</dd>
      </div>
      <div>
        <dt>Agenda</dt>
        <dd>
          {settings.startTime}–{settings.endTime}
        </dd>
      </div>
      <div>
        <dt>Prazo sem movimento</dt>
        <dd>{settings.offDelaySec} s</dd>
      </div>
      <div>
        <dt>Fuso horário</dt>
        <dd>São Paulo · UTC−3</dd>
      </div>
    </dl>
  );
}
export function ConfigurationSummary({ snapshot, connected }: LiveProps) {
  const state = snapshot?.device.state;
  const applied = snapshot?.configs.find(
    (c) =>
      c.config_version === state?.appliedConfigVersion &&
      c.status === "APPLIED",
  );
  const desired = snapshot?.configs[0];
  return (
    <section className="card configuration-summary">
      <div className="section-title">
        <div>
          <p className="eyebrow">CONFIGURAÇÃO DO AMBIENTE</p>
          <h2>O que está em uso</h2>
        </div>
        <Icon name="settings" />
      </div>
      <Freshness snapshot={snapshot} connected={connected} />
      <div className="actual-values">
        <div>
          <span>Modo atual</span>
          <strong>{state ? names[state.mode] : "Sem informação"}</strong>
        </div>
        <div>
          <span>Brilho configurado atual</span>
          <strong>
            {state ? `${state.brightnessPct}%` : "Sem informação"}
          </strong>
        </div>
      </div>
      <div className="remote-config">
        <div className="config-heading">
          <h3>Configuração remota confirmada</h3>
          {state && (
            <span className="version">v{state.appliedConfigVersion}</span>
          )}
        </div>
        {applied ? (
          <ConfigValues settings={applied.payload} />
        ) : (
          <p className="hint">
            {state?.appliedConfigVersion
              ? "Os detalhes desta versão não estão disponíveis no histórico recente."
              : "Nenhuma configuração remota confirmada disponível."}
          </p>
        )}
        <p className="hint">
          Agenda e prazo correspondem à versão remota confirmada. Alterações
          feitas pelo serial nesses campos não são transmitidas.
        </p>
      </div>
      <div className="remote-config">
        <div className="config-heading">
          <h3>Última configuração enviada</h3>
          {desired && (
            <span
              className={`pill ${desired.status === "APPLIED" ? "success" : desired.status === "REJECTED" ? "danger" : "waiting"}`}
            >
              {desired.status === "PENDING"
                ? "Em confirmação"
                : names[desired.status]}
            </span>
          )}
        </div>
        {desired ? (
          <>
            <p className="hint">Versão {desired.config_version}</p>
            <ConfigValues settings={desired.payload} />
          </>
        ) : (
          <p className="hint">Nenhuma configuração enviada pelo painel.</p>
        )}
      </div>
    </section>
  );
}
export function DashboardView({ snapshot, connected }: LiveProps) {
  const state = snapshot?.device.state;
  const active = !!state?.requestId;
  return (
    <>
      <LiveMetrics snapshot={snapshot} connected={connected} />
      <div className="overview-grid">
        <section className="night-card">
          <div className="night-card-copy">
            <p className="eyebrow">CUIDADO QUE ACOMPANHA</p>
            <h2>
              O ambiente sob
              <br />
              seu cuidado.
            </h2>
            <p>
              A luz acompanha o movimento.
              <br />A ajuda está a um toque de distância.
            </p>
            <a href="#iluminacao" className="button light-button">
              Acompanhar iluminação
              <Icon name="arrow" />
            </a>
          </div>
          <div
            className={`light-scene ${state?.lightOn ? "lit" : ""}`}
            aria-hidden="true"
          >
            <span className="scene-orbit orbit-one" />
            <span className="scene-orbit orbit-two" />
            <span className="scene-orbit orbit-three" />
            <span className="scene-moon">
              <Icon name="moon" />
            </span>
            <span className="scene-lamp">
              <Icon name="light" />
            </span>
            <span className="scene-caption">
              {state
                ? state.lightOn
                  ? "Luz acesa"
                  : "Luz apagada"
                : "Aguardando ambiente"}
            </span>
          </div>
        </section>
        <section
          className={`card assistance-preview ${active ? "has-request" : ""}`}
        >
          <span className="section-icon">
            <Icon name="help" />
          </span>
          <p className="eyebrow">SEMPRE POR PERTO</p>
          <h2>
            {active
              ? names[state!.assistanceStatus]
              : state
                ? "Tudo tranquilo por aqui."
                : "Aguardando o ambiente."}
          </h2>
          <p>
            {active
              ? "Há um pedido de ajuda neste ambiente. Acompanhe o atendimento na tela de Assistência."
              : "Os pedidos de ajuda aparecem aqui e permanecem visíveis até a conclusão do atendimento."}
          </p>
          <a className="text-link" href="#assistencia">
            {active ? "Acompanhar chamado" : "Ver assistência"}
            <Icon name="arrow" />
          </a>
        </section>
      </div>
      <div className="two-columns">
        <section className="card">
          <div className="section-title">
            <div>
              <p className="eyebrow">ILUMINAÇÃO</p>
              <h2>Conforto a cada movimento</h2>
            </div>
            <Icon name="light" />
          </div>
          <Freshness snapshot={snapshot} connected={connected} />
          <dl className="detail-list">
            <div>
              <dt>Modo aplicado</dt>
              <dd>{state ? names[state.mode] : "Sem informação"}</dd>
            </div>
            <div>
              <dt>Brilho configurado</dt>
              <dd>{state ? `${state.brightnessPct}%` : "Sem informação"}</dd>
            </div>
            <div>
              <dt>Movimento</dt>
              <dd>
                {state
                  ? state.motion
                    ? "Detectado"
                    : "Sem movimento"
                  : "Sem informação"}
              </dd>
            </div>
          </dl>
          <a className="text-link" href="#iluminacao">
            Ajustar iluminação
            <Icon name="arrow" />
          </a>
        </section>
        <section className="card">
          <div className="section-title">
            <div>
              <p className="eyebrow">ACOMPANHAMENTO</p>
              <h2>Conexão do ambiente</h2>
            </div>
            <Icon name="connection" />
          </div>
          <dl className="detail-list">
            <div>
              <dt>Atualização do painel</dt>
              <dd>
                <StatusBadge online={connected}>
                  {connected ? "Conectado" : "Desconectado"}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt>Conexão do serviço</dt>
              <dd>
                {connected
                  ? snapshot?.brokerConnected
                    ? "Conectado"
                    : "Desconectado"
                  : "Sem atualização"}
              </dd>
            </div>
            <div>
              <dt>Relógio do ambiente</dt>
              <dd>
                {state
                  ? state.clockValid
                    ? "Sincronizado"
                    : "Não sincronizado"
                  : "Sem informação"}
              </dd>
            </div>
            <div>
              <dt>Última comunicação</dt>
              <dd>{date(snapshot?.device.lastSeen ?? null)}</dd>
            </div>
          </dl>
          <a className="text-link" href="#administracao">
            Ver detalhes do ambiente
            <Icon name="arrow" />
          </a>
        </section>
      </div>
    </>
  );
}

type LightingProps = LiveProps & {
  form: Settings;
  dirty: boolean;
  saving: boolean;
  change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  save: (e: FormEvent) => void;
};
export function LightingView({
  snapshot,
  connected,
  form,
  dirty,
  saving,
  change,
  save,
}: LightingProps) {
  const state = snapshot?.device.state;
  return (
    <>
      <section className="lighting-status card">
        <div>
          <p className="eyebrow">ESTADO DO AMBIENTE</p>
          <h2>
            {state
              ? state.lightOn
                ? "O caminho está iluminado."
                : "Iluminação em espera."
              : "Aguardando o primeiro estado."}
          </h2>
          <Freshness snapshot={snapshot} connected={connected} />
        </div>
        <div className="lighting-indicators">
          <div>
            <Icon name="light" />
            <span>
              Luz
              <strong>
                {state ? (state.lightOn ? "Acesa" : "Apagada") : "—"}
              </strong>
            </span>
          </div>
          <div>
            <Icon name="motion" />
            <span>
              Movimento
              <strong>
                {state ? (state.motion ? "Detectado" : "Sem movimento") : "—"}
              </strong>
            </span>
          </div>
        </div>
      </section>
      <div className="two-columns lighting-columns">
        <section className="card">
          <div className="section-title">
            <div>
              <p className="eyebrow">PREFERÊNCIAS DE ILUMINAÇÃO</p>
              <h2>Ajuste para o ambiente</h2>
            </div>
            <Icon name="settings" />
          </div>
          <form onSubmit={save}>
            <label>
              Modo
              <select
                value={form.mode}
                onChange={(e) =>
                  change("mode", e.target.value as Settings["mode"])
                }
              >
                <option value="AUTO">Automático</option>
                <option value="ON">Ligado</option>
                <option value="OFF">Desligado</option>
              </select>
            </label>
            <div className="fields">
              <label>
                Brilho (%)
                <input
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={form.brightnessPct}
                  onChange={(e) =>
                    change("brightnessPct", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Prazo após movimento (s)
                <input
                  type="number"
                  min="1"
                  max="600"
                  required
                  value={form.offDelaySec}
                  onChange={(e) =>
                    change("offDelaySec", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Início da agenda
                <input
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => change("startTime", e.target.value)}
                />
              </label>
              <label>
                Fim da agenda
                <input
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => change("endTime", e.target.value)}
                />
              </label>
            </div>
            <p className="hint">
              São Paulo · UTC−3. Horários iguais habilitam 24 h. O botão de
              ajuda funciona a qualquer hora.
            </p>
            <button disabled={saving || !connected}>
              {saving ? "Enviando…" : "Enviar configuração"}
            </button>
            {dirty && (
              <span className="edit-label"> Alterações não enviadas</span>
            )}
          </form>
        </section>
        <ConfigurationSummary snapshot={snapshot} connected={connected} />
      </div>
    </>
  );
}

type AssistanceProps = LiveProps & {
  wait: number | null;
  canAct: boolean;
  busy: boolean;
  command: (action: string) => void;
};
export function AssistanceView({
  snapshot,
  connected,
  wait,
  canAct,
  busy,
  command,
}: AssistanceProps) {
  const state = snapshot?.device.state;
  return (
    <div className="two-columns assistance-columns">
      <section
        className={`card assistance ${state?.requestId ? "has-request" : ""}`}
      >
        <span className="section-icon">
          <Icon name="help" />
        </span>
        <p className="eyebrow">PEDIDO DE AJUDA</p>
        <h2>
          {state ? names[state.assistanceStatus] : "Aguardando o ambiente"}
        </h2>
        <Freshness snapshot={snapshot} connected={connected} />
        {state?.requestId ? (
          <>
            <div className="wait-time">
              <span>Tempo desde a abertura</span>
              <strong>
                {wait === null
                  ? "Tempo desconhecido"
                  : `${Math.floor(wait / 60)} min ${wait % 60} s`}
              </strong>
            </div>
            <p>
              {state.assistanceStatus === "PENDING"
                ? "O botão de ajuda foi acionado. Reconheça o pedido para indicar que o atendimento está a caminho."
                : "O pedido foi reconhecido. Encerre quando o atendimento estiver concluído."}
            </p>
          </>
        ) : (
          <p>
            Quando o botão de ajuda for acionado, o pedido aparecerá aqui. A
            iluminação continua funcionando de forma independente.
          </p>
        )}
        <div className="actions">
          <button
            disabled={!canAct || state?.assistanceStatus !== "PENDING"}
            onClick={() => command("ACK_HELP")}
          >
            <Icon name="check" />
            Reconhecer
          </button>
          <button
            className="secondary"
            disabled={!canAct || state?.assistanceStatus !== "ACKNOWLEDGED"}
            onClick={() => command("CLOSE_HELP")}
          >
            Encerrar atendimento
          </button>
        </div>
        {state?.requestId && !state.clockValid && (
          <p className="notice">
            O relógio precisa estar sincronizado para confirmar ações. Retorne à
            hora real no dispositivo e aguarde a sincronização.
          </p>
        )}
        {busy && (
          <p className="hint">
            Aguardando confirmação do dispositivo. Sem resposta em 10 segundos,
            o resultado será indicado como não confirmado.
          </p>
        )}
      </section>
      <section className="card">
        <div className="section-title">
          <div>
            <p className="eyebrow">ACOMPANHAMENTO DO ATENDIMENTO</p>
            <h2>Últimas ações</h2>
          </div>
          <Icon name="clock" />
        </div>
        <p className="hint">
          A confirmação é enviada pelo dispositivo. Enviar uma ação ainda não
          significa que ela foi aplicada.
        </p>
        <div className="command-list">
          {snapshot?.commands.slice(0, 5).map((c) => (
            <div key={c.command_id}>
              <span
                className={`command-mark ${c.status === "APPLIED" ? "done" : ""}`}
              >
                <Icon name={c.status === "APPLIED" ? "check" : "clock"} />
              </span>
              <div>
                <strong>{names[c.action]}</strong>
                <span
                  className={`pill ${c.status === "APPLIED" ? "success" : c.status === "REJECTED" ? "danger" : "waiting"}`}
                >
                  {c.status === "PENDING"
                    ? "Enviado"
                    : (names[c.status] ?? c.status)}
                </span>
              </div>
            </div>
          ))}
        </div>
        {!snapshot?.commands.length && (
          <div className="empty-state">
            <Icon name="clock" />
            <p>As ações de atendimento aparecerão aqui.</p>
          </div>
        )}
      </section>
    </div>
  );
}

type AdminProps = LiveProps & {
  events: EventRow[];
  filter: HistoryFilter;
  setFilter: Dispatch<SetStateAction<HistoryFilter>>;
  historyError: string;
  demo: boolean | null;
};
export function AdminView({
  snapshot,
  connected,
  events,
  filter,
  setFilter,
  historyError,
  demo,
}: AdminProps) {
  const state = snapshot?.device.state;
  return (
    <>
      <div className="two-columns admin-columns">
        <ConfigurationSummary snapshot={snapshot} connected={connected} />
        <section className="card">
          <div className="section-title">
            <div>
              <p className="eyebrow">INFORMAÇÕES DO AMBIENTE</p>
              <h2>Conexão e dispositivo</h2>
            </div>
            <Icon name="connection" />
          </div>
          <dl className="detail-list">
            <div>
              <dt>Dispositivo</dt>
              <dd className="mono">nightcare-001</dd>
            </div>
            <div>
              <dt>Comunicação MQTT</dt>
              <dd>
                {connected
                  ? snapshot?.brokerConnected
                    ? "Conectada"
                    : "Desconectada"
                  : "Sem atualização"}
              </dd>
            </div>
            <div>
              <dt>Atualizações WebSocket</dt>
              <dd>{connected ? "Conectadas" : "Desconectadas"}</dd>
            </div>
            <div>
              <dt>Última comunicação</dt>
              <dd>{date(snapshot?.device.lastSeen ?? null)}</dd>
            </div>
            <div>
              <dt>Relógio</dt>
              <dd>
                {state
                  ? state.clockValid
                    ? "Sincronizado"
                    : "Inválido ou em teste"
                  : "Sem informação"}
              </dd>
            </div>
            <div>
              <dt>Persistência no dispositivo</dt>
              <dd>
                {state
                  ? state.persistenceOk
                    ? "Operacional"
                    : "Falha"
                  : "Sem informação"}
              </dd>
            </div>
            <div>
              <dt>Eventos descartados</dt>
              <dd>{state?.droppedEvents ?? "—"}</dd>
            </div>
            {state?.requestId && (
              <div>
                <dt>Identificador do chamado</dt>
                <dd className="mono">{state.requestId}</dd>
              </div>
            )}
          </dl>
          {demo && (
            <p className="hint admin-disclosure">
              Este ambiente usa um broker público de testes. Use somente dados
              fictícios.
            </p>
          )}
          <a className="text-link" href="#iluminacao">
            Editar configuração de iluminação
            <Icon name="arrow" />
          </a>
          {snapshot?.commands.length ? (
            <details className="technical-details">
              <summary>Detalhes dos comandos</summary>
              {snapshot.commands.slice(0, 5).map((c) => (
                <p key={c.command_id} className="mono">
                  {c.command_id}
                  <br />
                  {c.status}
                  {c.reason ? ` · ${c.reason}` : ""}
                </p>
              ))}
            </details>
          ) : null}
          {snapshot?.configs[0]?.reason && (
            <p className="hint mono">
              Resultado da configuração: {snapshot.configs[0].reason}
            </p>
          )}
        </section>
      </div>
      <section className="card history">
        <div className="history-heading">
          <div>
            <p className="eyebrow">REGISTROS DO DISPOSITIVO</p>
            <h2>Histórico de eventos</h2>
          </div>
          <span>Até 100 registros · período pelo recebimento</span>
        </div>
        <div className="filters">
          <label>
            Tipo
            <select
              value={filter.type}
              onChange={(e) =>
                setFilter((f) => ({ ...f, type: e.target.value }))
              }
            >
              <option value="">Todos os eventos</option>
              {Object.entries(eventNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input
              type="datetime-local"
              value={filter.from}
              onChange={(e) =>
                setFilter((f) => ({ ...f, from: e.target.value }))
              }
            />
          </label>
          <label>
            Até
            <input
              type="datetime-local"
              value={filter.to}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
            />
          </label>
        </div>
        {historyError && (
          <p role="alert" className="error">
            {historyError}
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Recebido em</th>
                <th>Evento</th>
                <th>Chamado</th>
                <th>Horário no ESP32</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.event_id}>
                  <td>{date(e.received_at)}</td>
                  <td>{eventNames[e.type] ?? e.type}</td>
                  <td className="request">{e.request_id ?? "—"}</td>
                  <td>{date(e.occurred_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!events.length && (
          <p className="empty">
            Nenhum evento neste período. Os registros aparecerão conforme o
            ambiente enviar atividades.
          </p>
        )}
      </section>
    </>
  );
}
