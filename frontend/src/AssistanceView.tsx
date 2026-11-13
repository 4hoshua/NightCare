import { useEffect, useState, type ReactNode } from "react";
import { type Snapshot, names } from "./model";
import { DeviceSignals } from "./DeviceSignals";
import { HelpTooltip } from "./HelpTooltip";
import { Icon } from "./navigation";

const results = [
  { status: "APPLIED", label: "Confirmados", color: "#efd38e" },
  { status: "REJECTED", label: "Recusados", color: "#efa89e" },
  { status: "PENDING", label: "Pendentes", color: "#c7b080" },
  { status: "UNCONFIRMED", label: "Não confirmados", color: "#8a819b" },
];

function CallCharts({
  snapshot,
  active,
}: {
  snapshot: Snapshot | null;
  active: boolean;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setEntered(false);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const state = snapshot?.device.state;
  const hasCall = !!state?.requestId;
  const presses = hasCall ? state.pressCount : 0;
  const commands = hasCall
    ? snapshot!.commands.filter((c) => c.request_id === state.requestId)
    : [];
  let offset = 0;
  return (
    <>
      <article className="analytics-chart assistance-presses">
        <div className="chart-title">
          <h3>Acionamentos de ajuda</h3>
          <HelpTooltip label="Acionamentos de ajuda">
            Contagem do botão AJUDA no chamado atual: um acionamento inicial e
            as reiterações seguintes. Não representa chamados distintos.
          </HelpTooltip>
        </div>
        <strong
          className="assistance-kpi-value"
          key={`${state?.requestId}:${presses}`}
        >
          {hasCall ? presses : "—"}
        </strong>
        {hasCall && presses > 0 ? (
          <>
            <div
              className="assistance-press-bar"
              role="img"
              aria-label={`1 acionamento inicial e ${Math.max(0, presses - 1)} reiterações`}
            >
              <span
                style={{
                  width: `${100 / presses}%`,
                  transform: `scaleX(${entered ? 1 : 0})`,
                }}
              />
              <span
                style={{
                  width: `${(100 * (presses - 1)) / presses}%`,
                  transform: `scaleX(${entered ? 1 : 0})`,
                }}
              />
            </div>
            <div className="assistance-legend">
              <span>
                Inicial <b>1</b>
              </span>
              <span>
                Reiterações <b>{presses - 1}</b>
              </span>
            </div>
          </>
        ) : (
          <p className="assistance-empty">
            {hasCall ? "Contagem indisponível." : "Sem chamado ativo."}
          </p>
        )}
      </article>
      <article className="analytics-chart">
        <div className="chart-title">
          <h3>Resultados dos comandos</h3>
          <HelpTooltip label="Resultados dos comandos">
            Somente comandos do chamado atual presentes no snapshot (até 30
            comandos recentes do leito). A amostra pode estar incompleta. Enviar
            ou receber confirmação de transporte não significa aplicação no
            dispositivo.
          </HelpTooltip>
        </div>
        {commands.length ? (
          <div className="assistance-results">
            <svg
              viewBox="0 0 140 140"
              role="img"
              aria-label={results
                .map(
                  (r) =>
                    `${r.label}: ${commands.filter((c) => c.status === r.status).length}`,
                )
                .join("; ")}
            >
              <circle
                cx="70"
                cy="70"
                r="52"
                fill="none"
                stroke="#363744"
                strokeWidth="15"
              />
              {results.map((r) => {
                const count = commands.filter(
                  (c) => c.status === r.status,
                ).length;
                const ratio = (count / commands.length) * 100;
                const start = offset;
                offset += ratio;
                return (
                  <circle
                    key={r.status}
                    className="assistance-donut-segment"
                    cx="70"
                    cy="70"
                    r="52"
                    fill="none"
                    stroke={r.color}
                    strokeWidth="15"
                    pathLength="100"
                    strokeDasharray={`${entered ? ratio : 0} 100`}
                    strokeDashoffset={-start}
                    transform="rotate(-90 70 70)"
                  />
                );
              })}
              <text
                x="70"
                y="70"
                textAnchor="middle"
                className="assistance-donut-total"
              >
                {commands.length}
              </text>
              <text
                x="70"
                y="88"
                textAnchor="middle"
                className="assistance-donut-label"
              >
                na amostra
              </text>
            </svg>
            <dl>
              {results.map((r) => (
                <div key={r.status}>
                  <dt>
                    <i style={{ background: r.color }} />
                    {r.label}
                  </dt>
                  <dd
                    key={commands.filter((c) => c.status === r.status).length}
                  >
                    {commands.filter((c) => c.status === r.status).length}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="assistance-empty">
            {hasCall
              ? "Nenhum comando disponível para este chamado."
              : "Sem chamado ativo."}
          </p>
        )}
      </article>
    </>
  );
}

export function AssistanceView({
  deviceContext,
  snapshot,
  connected,
  active,
  wait,
  canAct,
  busy,
  command,
}: {
  deviceContext: ReactNode;
  snapshot: Snapshot | null;
  connected: boolean;
  active: boolean;
  wait: number | null;
  canAct: boolean;
  busy: boolean;
  command: (action: string) => void;
}) {
  const state = snapshot?.device.state;
  const live =
    connected && !!snapshot?.brokerConnected && !!snapshot?.device.online;
  const hasCall = !!state?.requestId;
  const request =
    snapshot?.activeRequest ??
    snapshot?.requests.find((r) => r.request_id === state?.requestId);
  const duration = live
    ? wait
    : request?.opened_at != null && snapshot?.device.lastSeen != null
      ? Math.max(
          0,
          Math.floor((snapshot.device.lastSeen - request.opened_at) / 1000),
        )
      : null;
  return (
    <div className={`assistance-page ${active ? "is-active" : ""}`}>
      <section className="card lighting-state assistance-state assistance-enter">
        <div>
          <p className="eyebrow">ESTADO DO ATENDIMENTO</p>
          <h2>
            {state ? names[state.assistanceStatus] : "Aguardando o ambiente"}
          </h2>
        </div>
        {deviceContext}
        <div data-signal-live={live}>
          <DeviceSignals
            state={state ?? null}
            fields={["assistance", "clock"]}
            className="lighting-signals"
          />
        </div>
      </section>
      <section className="card assistance-care assistance-enter">
        <div className="section-title">
          <div>
            <p className="eyebrow">PEDIDO DE AJUDA</p>
            <h2>
              {state ? names[state.assistanceStatus] : "Aguardando o ambiente"}
            </h2>
          </div>
          <HelpTooltip label="Pedido de ajuda">
            {hasCall
              ? state?.assistanceStatus === "PENDING"
                ? "Reconheça o pedido para indicar que o atendimento está a caminho."
                : "Encerre quando o atendimento estiver concluído."
              : "Quando o botão AJUDA for acionado, o pedido aparecerá aqui. A iluminação funciona de forma independente."}
          </HelpTooltip>
        </div>
        {hasCall ? (
          <p className="mono assistance-request-id">{state.requestId}</p>
        ) : (
          <p className="assistance-empty">Nenhum pedido em andamento.</p>
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
          <HelpTooltip label="Ações de atendimento">
            {!snapshot?.device.bed
              ? "Associe o dispositivo a um leito para operar."
              : !live
                ? "Aguarde a conexão do painel, serviço e dispositivo."
                : "Reconhecer precede encerrar. A aplicação depende da confirmação do dispositivo e de relógio válido."}
          </HelpTooltip>
        </div>
        {hasCall && !state.clockValid && (
          <p className="notice">
            O relógio precisa estar sincronizado para confirmar ações. Retorne à
            hora real no dispositivo e aguarde a sincronização.
          </p>
        )}
        {busy && (
          <p role="status" className="notice">
            Aguardando confirmação do dispositivo. Sem resposta em 10 segundos,
            o resultado será indicado como não confirmado.
          </p>
        )}
        <div className="assistance-follow-up">
          <div className="chart-title">
            <h3>Acompanhamento de Atendimento</h3>
            <HelpTooltip label="Acompanhamento de Atendimento">
              Últimas cinco ações do leito selecionado, inclusive de chamados
              anteriores. A confirmação é enviada pelo dispositivo; enviar uma
              ação ainda não significa que ela foi aplicada.
            </HelpTooltip>
          </div>
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
            <p className="assistance-empty">
              As ações de atendimento aparecerão aqui.
            </p>
          )}
        </div>
      </section>
      <section className="card assistance-analytics assistance-enter">
        <div className="section-title">
          <div>
            <p className="eyebrow">CHAMADO ATUAL</p>
            <h2>Indicadores de assistência</h2>
          </div>
        </div>
        <div className="assistance-kpis">
          <article className="analytics-chart">
            <div className="chart-title">
              <h3>Tempo desde a abertura</h3>
              <HelpTooltip label="Tempo desde a abertura">
                Duração desde a abertura, inclusive após reconhecimento. Não
                representa tempo até o atendimento ou uma meta. Offline,
                considera a última comunicação; sem data de abertura, o tempo é
                desconhecido.
              </HelpTooltip>
            </div>
            <strong className="assistance-kpi-value">
              {!hasCall
                ? "—"
                : duration === null
                  ? "Tempo desconhecido"
                  : `${Math.floor(duration / 60)} min ${duration % 60} s`}
            </strong>
            <span className="assistance-kpi-caption">
              {!hasCall
                ? "Sem chamado ativo"
                : live
                  ? "Desde a abertura do chamado"
                  : "Na última comunicação"}
            </span>
          </article>
          <CallCharts snapshot={snapshot} active={active} />
        </div>
      </section>
    </div>
  );
}
