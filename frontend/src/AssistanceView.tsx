import { useLayoutEffect, useRef, type ReactNode } from "react";
import { type Snapshot, names } from "./model";
import { DeviceSignals } from "./DeviceSignals";
import { HelpTooltip } from "./HelpTooltip";
import { Icon } from "./navigation";
import { AssistanceAnalytics } from "./AssistanceAnalytics";
import type { AssistancePeriod, AssistanceQuery } from "./assistance-model";
import { ScrollArea } from "./ScrollArea";

export function AssistanceView({
  deviceContext,
  analytics,
  period,
  onPeriodChange,
  snapshot,
  connected,
  active,
  wait,
  canAct,
  busy,
  command,
}: {
  deviceContext: ReactNode;
  analytics: AssistanceQuery;
  period: AssistancePeriod;
  onPeriodChange: (period: AssistancePeriod) => void;
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
  const commands = snapshot?.commands.slice(0, 30) ?? [];
  const history = useRef<HTMLDivElement>(null);
  const readingAnchor = useRef<{
    id: string;
    offset: number;
    scrollTop: number;
  } | null>(null);
  function rememberReading() {
    const area = history.current;
    if (!area || area.scrollTop <= 1) {
      readingAnchor.current = null;
      return;
    }
    const top = area.getBoundingClientRect().top;
    const row = [
      ...area.querySelectorAll<HTMLElement>("[data-command-id]"),
    ].find((r) => r.getBoundingClientRect().bottom > top);
    if (row)
      readingAnchor.current = {
        id: row.dataset.commandId!,
        offset: row.getBoundingClientRect().top - top,
        scrollTop: area.scrollTop,
      };
  }
  const commandRevision = commands
    .map((c) => `${c.command_id}:${c.status}`)
    .join("|");
  useLayoutEffect(() => {
    const area = history.current,
      anchor = readingAnchor.current;
    if (!area) return;
    if (!anchor) {
      area.scrollTop = 0;
      return;
    }
    const row = [
      ...area.querySelectorAll<HTMLElement>("[data-command-id]"),
    ].find((r) => r.dataset.commandId === anchor.id);
    if (row)
      area.scrollTop +=
        row.getBoundingClientRect().top -
        area.getBoundingClientRect().top -
        anchor.offset;
    else area.scrollTop = anchor.scrollTop;
    rememberReading();
  }, [commandRevision]);
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
            {state?.assistanceStatus !== "NONE" && (
              <h2>
                {state
                  ? names[state.assistanceStatus]
                  : "Aguardando o ambiente"}
              </h2>
            )}
          </div>
          <HelpTooltip label="Pedido de ajuda">
            {hasCall
              ? state?.assistanceStatus === "PENDING"
                ? "Reconheça o pedido para indicar que o atendimento está a caminho."
                : "Encerre quando o atendimento estiver concluído."
              : "Quando o botão AJUDA for acionado, o pedido aparecerá aqui. A iluminação funciona de forma independente."}
          </HelpTooltip>
        </div>
        {hasCall && (
          <p className="mono assistance-request-id">{state.requestId}</p>
        )}
        <div className="assistance-live-duration">
          <div className="chart-title">
            <h3>Tempo desde a abertura</h3>
            <HelpTooltip label="Tempo desde a abertura">
              Duração desde a abertura, inclusive após reconhecimento. Não
              representa tempo até o atendimento ou uma meta. Offline, considera
              a última comunicação.
            </HelpTooltip>
          </div>
          <strong className="assistance-kpi-value">
            {!state || (hasCall && duration === null)
              ? "Tempo indisponível"
              : !hasCall
                ? "0 min 0 s"
                : `${Math.floor(duration! / 60)} min ${duration! % 60} s`}
          </strong>
        </div>
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
            O relógio precisa estar sincronizado para confirmar ações. Aguarde a
            sincronização automática. Modos de teste do relógio não permitem
            atendimento remoto.
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
              Até 30 ações recentes do leito selecionado, inclusive de chamados
              anteriores. A confirmação é enviada pelo dispositivo; enviar uma
              ação ainda não significa que ela foi aplicada. Consulte ações
              anteriores na tela Histórico.
            </HelpTooltip>
          </div>
          <div className="assistance-history-frame">
            <ScrollArea
              ref={history}
              className="assistance-history-scroll"
              aria-label="Ações recentes de atendimento"
              onScroll={rememberReading}
            >
              <div className="command-list">
                {commands.map((c) => (
                  <div key={c.command_id} data-command-id={c.command_id}>
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
            </ScrollArea>
          </div>
        </div>
      </section>
      <AssistanceAnalytics
        query={analytics}
        period={period}
        onPeriodChange={onPeriodChange}
        active={active}
        connected={connected}
        hasDevice={!!snapshot}
        canUseAgenda={
          !!snapshot?.device.state?.runtimeSettings || !!snapshot?.appliedConfig
        }
      />
    </div>
  );
}
