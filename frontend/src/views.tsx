import { date, names, type Settings, type Snapshot } from "./model";
import { Icon, type IconName } from "./navigation";

type LiveProps = { snapshot: Snapshot | null; connected: boolean };
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
export function Freshness({ snapshot, connected }: LiveProps) {
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
export function ConfigurationDetails({ snapshot, connected }: LiveProps) {
  const state = snapshot?.device.state;
  const applied =
    snapshot?.appliedConfig ??
    snapshot?.configs.find(
      (c) =>
        c.config_version === state?.appliedConfigVersion &&
        c.status === "APPLIED",
    );
  const desired = snapshot?.configs[0];
  return (
    <>
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
        <h3>Parâmetros atuais do dispositivo</h3>
        {state?.runtimeSettings ? (
          <dl className="config-values">
            <div>
              <dt>Agenda atual</dt>
              <dd>
                {state.runtimeSettings.startTime}–
                {state.runtimeSettings.endTime}
              </dd>
            </div>
            <div>
              <dt>Prazo atual sem movimento</dt>
              <dd>{state.runtimeSettings.offDelaySec} s</dd>
            </div>
            <div>
              <dt>Fuso atual</dt>
              <dd>
                UTC{state.runtimeSettings.timezoneOffsetHours >= 0 ? "+" : ""}
                {state.runtimeSettings.timezoneOffsetHours}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="hint">
            Telemetria dos parâmetros atuais indisponível. Atualize o firmware
            para acompanhar alterações seriais.
          </p>
        )}
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
              ? "Os detalhes desta versão não estão disponíveis no banco de dados."
              : "Nenhuma configuração remota confirmada disponível."}
          </p>
        )}
        <p className="hint">
          Agenda e prazo correspondem à versão remota confirmada. Alterações
          feitas pelo serial aparecem nos parâmetros atuais quando o firmware
          oferece essa telemetria.
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
            {desired.reason && (
              <p className="hint">Resultado informado: {desired.reason}</p>
            )}
          </>
        ) : (
          <p className="hint">Nenhuma configuração enviada pelo painel.</p>
        )}
      </div>
    </>
  );
}
export function ConfigurationSummary({ snapshot, connected }: LiveProps) {
  return (
    <section className="card configuration-summary">
      <div className="section-title">
        <div>
          <p className="eyebrow">CONFIGURAÇÃO DO AMBIENTE</p>
          <h2>O que está em uso</h2>
        </div>
        <Icon name="settings" />
      </div>
      <ConfigurationDetails snapshot={snapshot} connected={connected} />
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
