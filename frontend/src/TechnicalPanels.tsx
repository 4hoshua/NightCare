import { useState, type ReactNode } from "react";
import { date, names, type Settings, type Snapshot } from "./model";
import { Icon, type IconName } from "./navigation";
import { Freshness } from "./views";

type Props = { snapshot: Snapshot | null; connected: boolean };
type Value = [label: string, value: string | number];
const unavailable = "Indisponível";
function settingsValues(settings?: Settings): Value[] {
  return [
    ["Modo", settings ? names[settings.mode] : unavailable],
    ["Brilho", settings ? `${settings.brightnessPct}%` : unavailable],
    [
      "Agenda",
      settings ? `${settings.startTime}–${settings.endTime}` : unavailable,
    ],
    ["Prazo", settings ? `${settings.offDelaySec} s` : unavailable],
    [
      "Fuso",
      settings
        ? settings.timezone === "America/Sao_Paulo"
          ? "São Paulo · UTC−3"
          : settings.timezone
        : unavailable,
    ],
  ];
}
function Values({
  values,
  className = "",
}: {
  values: Value[];
  className?: string;
}) {
  return (
    <dl className={`technical-values ${className}`}>
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Disclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="technical-disclosure"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {title}
        <Icon name={open ? "collapse" : "expand"} />
      </summary>
      <div className="technical-disclosure-body">{children}</div>
    </details>
  );
}
export function ConfigurationPanel({ snapshot, connected }: Props) {
  const state = snapshot?.device.state,
    runtime = state?.runtimeSettings;
  const applied =
    snapshot?.appliedConfig ??
    snapshot?.configs.find(
      (c) =>
        c.config_version === state?.appliedConfigVersion &&
        c.status === "APPLIED",
    );
  const desired = snapshot?.configs[0];
  const outcome = !desired
    ? "Sem envio"
    : desired.status === "APPLIED"
      ? "Confirmada"
      : desired.status === "REJECTED"
        ? "Recusada"
        : desired.status === "PENDING"
          ? "Aguardando confirmação"
          : (names[desired.status] ?? desired.status);
  const current: Value[] = [
    ["Modo", state ? names[state.mode] : unavailable],
    ["Brilho", state ? `${state.brightnessPct}%` : unavailable],
    [
      "Agenda",
      runtime ? `${runtime.startTime}–${runtime.endTime}` : unavailable,
    ],
    ["Prazo", runtime ? `${runtime.offDelaySec} s` : unavailable],
    [
      "Fuso",
      runtime
        ? `UTC${runtime.timezoneOffsetHours >= 0 ? "+" : ""}${runtime.timezoneOffsetHours}`
        : unavailable,
    ],
  ];
  return (
    <div className="technical-configuration">
      <div className="technical-overview">
        <Freshness
          snapshot={snapshot}
          connected={connected && !!snapshot?.brokerConnected}
        />
      </div>
      <div className="configuration-sources">
        <section
          className="configuration-source source-current"
          aria-label="Configuração atual"
        >
          <h3>
            <Icon name="light" />
            Atual
          </h3>
          <Values values={current} />
          {state && !runtime && (
            <p className="technical-source-note">
              Parâmetros atuais sem telemetria.
            </p>
          )}
        </section>
        <section
          className="configuration-source source-confirmed"
          aria-label="Configuração remota confirmada"
        >
          <h3>
            <Icon name="check" />
            Remota confirmada
          </h3>
          <Values values={settingsValues(applied?.payload)} />
          {!applied && (
            <p className="technical-source-note">
              {state?.appliedConfigVersion
                ? "Detalhes da versão indisponíveis."
                : "Nenhuma configuração remota confirmada disponível."}
            </p>
          )}
        </section>
        <section
          className="configuration-source source-sent"
          aria-label="Última configuração enviada"
        >
          <h3>
            <Icon name="arrow" />
            Último envio
          </h3>
          <Values values={settingsValues(desired?.payload)} />
          {!desired && (
            <p className="technical-source-note">
              Nenhuma configuração enviada pelo painel.
            </p>
          )}
        </section>
      </div>
      <Disclosure title="Versões, resultado e detalhes">
        <Values
          values={[
            [
              "Versão aplicada informada",
              state ? `v${state.appliedConfigVersion}` : unavailable,
            ],
            [
              "Versão remota confirmada no banco",
              applied ? `v${applied.config_version}` : unavailable,
            ],
            [
              "Versão do último envio",
              desired ? `v${desired.config_version}` : unavailable,
            ],
            ["Resultado do último envio", outcome],
            ["Motivo informado", desired?.reason ?? "Sem motivo informado"],
            [
              "Fuso confirmado (identificador)",
              applied?.payload.timezone ?? unavailable,
            ],
            [
              "Fuso enviado (identificador)",
              desired?.payload.timezone ?? unavailable,
            ],
          ]}
          className="technical-detail-values"
        />
        <p>
          O resultado informado refere-se somente ao último envio; uma
          confirmação antiga não confirma a intenção nova. Agenda e prazo da
          coluna confirmada correspondem à versão remota confirmada. Alterações
          feitas pelo serial aparecem somente nos parâmetros atuais quando o
          firmware oferece essa telemetria; não alteram a intenção enviada pelo
          painel.
        </p>
        {!runtime && (
          <p>
            Telemetria dos parâmetros atuais indisponível. Atualize o firmware
            para acompanhar alterações seriais.
          </p>
        )}
        {!applied && state?.appliedConfigVersion ? (
          <p>
            Os detalhes desta versão não estão disponíveis no banco de dados.
          </p>
        ) : null}
      </Disclosure>
      <a className="text-link technical-edit" href="#iluminacao">
        Editar iluminação e movimento
        <Icon name="arrow" />
      </a>
    </div>
  );
}
function DiagnosticTile({
  title,
  icon,
  tone,
  value,
  children,
}: {
  title: string;
  icon: IconName;
  tone: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <article className={`diagnostic-tile is-${tone}`}>
      <div className="diagnostic-tile-title">
        <span className="diagnostic-tile-icon">
          <Icon name={icon} />
        </span>
        <h3>{title}</h3>
      </div>
      <strong className="diagnostic-tile-value" key={value}>
        {value}
      </strong>
      {children}
    </article>
  );
}
export function DiagnosticPanel({ snapshot, connected }: Props) {
  const state = snapshot?.device.state;
  const mqtt = !connected
    ? "Sem atualização"
    : snapshot
      ? snapshot.brokerConnected
        ? "Conectada"
        : "Desconectada"
      : "Sem informação";
  const ws = connected ? "Conectadas" : "Desconectadas";
  const clock = !state
    ? "Sem informação"
    : state.clockValid
      ? "Sincronizado"
      : "Inválido ou em teste";
  const persistence = !state
    ? "Sem informação"
    : state.persistenceOk
      ? "Operacional"
      : "Falha";
  const live =
    connected && !!snapshot?.brokerConnected && !!snapshot?.device.online;
  const observedTone = (bad: boolean) =>
    !state || !live ? "neutral" : bad ? "warning" : "positive";
  return (
    <div className={`technical-diagnostics ${live ? "is-live" : ""}`}>
      <Freshness
        snapshot={snapshot}
        connected={connected && !!snapshot?.brokerConnected}
      />
      <div className="diagnostic-tiles">
        <DiagnosticTile
          title="Comunicação"
          icon="connection"
          tone={
            !snapshot || !connected
              ? "neutral"
              : snapshot.brokerConnected
                ? "positive"
                : "warning"
          }
          value={`MQTT · ${mqtt}`}
        >
          <p>WebSocket · {ws}</p>
          <p>
            Última comunicação
            <br />
            <time>{date(snapshot?.device.lastSeen ?? null)}</time>
          </p>
        </DiagnosticTile>
        <DiagnosticTile
          title="Relógio"
          icon={
            !state ? "unknown" : state.clockValid ? "clock-check" : "warning"
          }
          tone={observedTone(!state?.clockValid)}
          value={clock}
        >
          {state && !state.clockValid && (
            <p className="diagnostic-alert">
              Ações remotas exigem hora real sincronizada.
            </p>
          )}
        </DiagnosticTile>
        <DiagnosticTile
          title="Persistência"
          icon={!state ? "unknown" : state.persistenceOk ? "check" : "warning"}
          tone={
            !state || !live
              ? "neutral"
              : state.persistenceOk
                ? "positive"
                : "danger"
          }
          value={persistence}
        >
          {state && !state.persistenceOk && (
            <p className="diagnostic-alert">
              Falha de persistência informada pelo dispositivo.
            </p>
          )}
        </DiagnosticTile>
        <DiagnosticTile
          title="Eventos descartados"
          icon={
            !state ? "unknown" : state.droppedEvents > 0 ? "warning" : "check"
          }
          tone={observedTone((state?.droppedEvents ?? 0) > 0)}
          value={state ? String(state.droppedEvents) : "Sem informação"}
        >
          <p>Contagem neste boot</p>
        </DiagnosticTile>
      </div>
      <Values
        className="diagnostic-strip"
        values={[
          [
            "Em execução no último estado",
            state ? `${Math.floor(state.uptimeMs / 1000)} s` : unavailable,
          ],
          ["Sequência", state?.sequence ?? unavailable],
          ["Acionamentos AJUDA", state?.pressCount ?? unavailable],
        ]}
      />
      <Disclosure title="Identificadores e diagnóstico completo">
        <Values
          className="technical-detail-values"
          values={[
            ["Dispositivo", snapshot?.device.deviceId ?? unavailable],
            ["Comunicação MQTT", mqtt],
            ["Atualizações WebSocket", ws],
            ["Última comunicação", date(snapshot?.device.lastSeen ?? null)],
            ["Inicialização (boot)", state?.bootId ?? unavailable],
            [
              "Tempo em execução no último estado",
              state ? `${Math.floor(state.uptimeMs / 1000)} s` : unavailable,
            ],
            ["Sequência do estado", state?.sequence ?? unavailable],
            ["Persistência no dispositivo", persistence],
            ["Relógio", clock],
            ["Eventos descartados", state?.droppedEvents ?? unavailable],
            ["Acionamentos do botão AJUDA", state?.pressCount ?? unavailable],
            ["Identificador do chamado", state?.requestId ?? "—"],
          ]}
        />
        <p>
          Presença expira após 45 segundos sem estado novo. O uptime corresponde
          ao último estado recebido; perdas são contadas em RAM e reiniciam com
          o dispositivo. Dados sem atualização ao vivo representam a última
          informação recebida.
        </p>
      </Disclosure>
    </div>
  );
}
