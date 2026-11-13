import { useEffect, useState } from "react";
import { localTime } from "./lighting-model";
import { HelpTooltip } from "./HelpTooltip";
import { Select } from "./Select";
import { CallActivityChart } from "./CallActivityChart";
import type { AssistancePeriod, AssistanceQuery } from "./assistance-model";

const results = [
  { key: "applied", label: "Confirmados", color: "#efd38e" },
  { key: "rejected", label: "Recusados", color: "#efa89e" },
  { key: "pending", label: "Pendentes", color: "#c7b080" },
  { key: "unconfirmed", label: "Não confirmados", color: "#8a819b" },
] as const;

export function AssistanceAnalytics({
  query,
  period,
  onPeriodChange,
  active,
  connected,
  hasDevice,
  canUseAgenda,
}: {
  query: AssistanceQuery;
  period: AssistancePeriod;
  onPeriodChange: (period: AssistancePeriod) => void;
  active: boolean;
  connected: boolean;
  hasDevice: boolean;
  canUseAgenda: boolean;
}) {
  const { data, error, loading, refresh } = query;
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setEntered(false);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const presses = data?.presses,
    commands = data?.commands;
  let offset = 0;
  return (
    <section
      className="card assistance-analytics assistance-enter"
      aria-label="Indicadores históricos de assistência"
    >
      <div className="analytics-heading">
        <div>
          <h2 className="card-label">Indicadores de assistência</h2>
        </div>
        <label>
          Período
          <Select<AssistancePeriod>
            label="Período dos indicadores de assistência"
            value={period}
            onValueChange={onPeriodChange}
            options={[
              { value: "24h", label: "Últimas 24 horas" },
              { value: "7d", label: "Últimos 7 dias" },
              { value: "30d", label: "Últimos 30 dias" },
              {
                value: "agenda",
                label: "Agenda do leito",
                disabled: !canUseAgenda,
              },
            ]}
          />
        </label>
      </div>
      <div className="analytics-summary assistance-analytics-meta">
        <p>
          {data
            ? `${localTime(data.from, data.timezoneOffsetHours)} até ${localTime(data.to, data.timezoneOffsetHours)}`
            : "—"}
        </p>
        <button
          className="notification-detail"
          type="button"
          onClick={refresh}
          disabled={!connected || !hasDevice || loading}
        >
          Atualizar Gráficos
        </button>
      </div>
      {!hasDevice ? (
        <p className="notice">
          Selecione um dispositivo para consultar seu histórico.
        </p>
      ) : (
        <>
          {(error || !connected) && (
            <p className="notice" role="status">
              {data ? "Dados desatualizados. " : "Indicadores indisponíveis. "}
              {error
                ? `Falha na consulta: ${error}. Nova tentativa automática; use Atualizar Gráficos para tentar agora.`
                : "Painel sem conexão; aguardando reconexão."}
            </p>
          )}
          {loading && connected && (
            <p className="assistance-empty" role="status">
              {data ? "Atualizando indicadores…" : "Carregando indicadores…"}
            </p>
          )}
          <div className="assistance-kpis" aria-busy={loading && connected}>
            <article className="analytics-chart assistance-call-activity">
              <div className="chart-title">
                <h3>Chamados ao longo do período</h3>
                <HelpTooltip label="Chamados ao longo do período">
                  Cada ponto representa chamados registrados pela primeira vez
                  no período: por hora em 24 horas ou Agenda do leito e por dia
                  em 7 ou 30 dias. Passe o mouse, use o teclado ou toque para
                  consultar intervalo e quantidade. Intervalos nas extremidades
                  podem ser parciais. A referência de agenda é a aplicada no
                  dispositivo; não usa rascunhos ou intenções pendentes.
                </HelpTooltip>
              </div>
              {data?.callActivity ? (
                <CallActivityChart data={data} />
              ) : (
                <div className="call-activity-placeholder">
                  <p className="assistance-empty">
                    {loading && connected
                      ? "Carregando distribuição…"
                      : "Distribuição indisponível."}
                  </p>
                </div>
              )}
            </article>
            <article className="analytics-chart assistance-presses">
              <div className="chart-title">
                <h3>Acionamentos de ajuda</h3>
                <HelpTooltip label="Acionamentos de ajuda">
                  Eventos de acionamento inicial e reiteração recebidos no
                  período, inclusive de chamados abertos anteriormente.
                  Heartbeats e recuperações após reinício não contam como novos
                  cliques. Não estima eventos que o backend não recebeu.
                </HelpTooltip>
              </div>
              <strong className="assistance-kpi-value">
                {presses ? presses.total : "—"}
              </strong>
              {presses && (
                <>
                  <div
                    className="assistance-press-bar"
                    role="img"
                    aria-label={`${presses.initial} acionamentos iniciais e ${presses.reiterations} reiterações`}
                  >
                    <span
                      style={{
                        width: `${presses.total ? (100 * presses.initial) / presses.total : 0}%`,
                        transform: `scaleX(${entered ? 1 : 0})`,
                      }}
                    />
                    <span
                      style={{
                        width: `${presses.total ? (100 * presses.reiterations) / presses.total : 0}%`,
                        transform: `scaleX(${entered ? 1 : 0})`,
                      }}
                    />
                  </div>
                  <div className="assistance-legend">
                    <span>
                      Iniciais <b>{presses.initial}</b>
                    </span>
                    <span>
                      Reiterações <b>{presses.reiterations}</b>
                    </span>
                  </div>
                </>
              )}
            </article>
            <article className="analytics-chart">
              <div className="chart-title">
                <h3>Resultados dos comandos</h3>
                <HelpTooltip label="Resultados dos comandos">
                  Todos os comandos enviados pelo backend no período, com o
                  resultado mais recente. Sem confirmação em dez segundos, o
                  resultado é não confirmado e pode mudar após resposta
                  posterior. Confirmação MQTT de transporte não confirma
                  aplicação.
                </HelpTooltip>
              </div>
              {commands ? (
                <div className="assistance-results">
                  <svg
                    viewBox="0 0 140 140"
                    role="img"
                    aria-label={`${commands.total} comandos no período. ${results.map((r) => `${r.label}: ${commands[r.key]}`).join("; ")}`}
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
                      const ratio = commands.total
                        ? (100 * commands[r.key]) / commands.total
                        : 0;
                      const start = offset;
                      offset += ratio;
                      return (
                        <circle
                          key={r.key}
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
                      {commands.total}
                    </text>
                    <text
                      x="70"
                      y="88"
                      textAnchor="middle"
                      className="assistance-donut-label"
                    >
                      no período
                    </text>
                  </svg>
                  <dl>
                    {results.map((r) => (
                      <div key={r.key}>
                        <dt>
                          <i style={{ background: r.color }} />
                          {r.label}
                        </dt>
                        <dd>{commands[r.key]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <strong className="assistance-kpi-value">—</strong>
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}
