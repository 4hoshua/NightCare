import { useState } from "react";
import { date, eventNames, names, type EventRow } from "./model";
import { Select } from "./Select";
import { HelpTooltip } from "./HelpTooltip";
import { useRecordPages } from "./records";

type Kind = "events" | "requests" | "configs" | "commands";
type Row = Partial<EventRow> & {
  device_id: string;
  status?: string;
  action?: string;
  command_id?: string;
  config_version?: number;
  created_at?: number;
  opened_at?: number;
  updated_at?: number;
  expires_at?: number;
  reason?: string;
  press_count?: number;
  payload?: Record<string, unknown>;
};
const titles: Record<Kind, string> = {
  events: "Eventos",
  requests: "Chamados",
  configs: "Configurações",
  commands: "Comandos",
};
function Collection({
  kind,
  scope,
  active,
  deviceNames,
}: {
  kind: Kind;
  scope: string;
  active: boolean;
  deviceNames: Record<string, string>;
}) {
  const [filter, setFilter] = useState({
    type: "",
    status: "",
    action: "",
    from: "",
    to: "",
  });
  const invalid = !!(filter.from && filter.to && filter.from > filter.to);
  const params = new URLSearchParams(scope === "all" ? { scope: "all" } : {});
  for (const [key, value] of Object.entries(filter))
    if (value)
      params.set(
        key,
        key === "from" || key === "to" ? new Date(value).toISOString() : value,
      );
  const records = useRecordPages<Row>(
    scope === "all" ? kind : `devices/${scope}/${kind}`,
    invalid || !scope ? null : params.toString(),
    active,
  );
  const statuses =
    kind === "requests"
      ? ["PENDING", "ACKNOWLEDGED", "CLOSED"]
      : kind === "configs"
        ? ["PENDING", "APPLIED", "REJECTED"]
        : ["PENDING", "APPLIED", "REJECTED", "UNCONFIRMED"];
  const set = (key: keyof typeof filter, value: string) =>
    setFilter((f) => ({ ...f, [key]: value }));
  return (
    <div hidden={!active} className="history-collection">
      <div className="history-filters">
        {kind === "events" ? (
          <label>
            Tipo
            <Select
              label="Tipo de evento"
              value={filter.type}
              onValueChange={(v) => set("type", v)}
              options={[
                { value: "", label: "Todos os eventos" },
                ...Object.entries(eventNames).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </label>
        ) : (
          <label>
            Resultado
            <Select
              label={`Resultado de ${titles[kind].toLowerCase()}`}
              value={filter.status}
              onValueChange={(v) => set("status", v)}
              options={[
                { value: "", label: "Todos os resultados" },
                ...statuses.map((value) => ({
                  value,
                  label:
                    value === "PENDING" && kind !== "requests"
                      ? "Em confirmação"
                      : names[value],
                })),
              ]}
            />
          </label>
        )}
        {kind === "commands" && (
          <label>
            Ação
            <Select
              label="Ação do comando"
              value={filter.action}
              onValueChange={(v) => set("action", v)}
              options={[
                { value: "", label: "Todas as ações" },
                ...["ACK_HELP", "CLOSE_HELP"].map((value) => ({
                  value,
                  label: names[value],
                })),
              ]}
            />
          </label>
        )}
        <label>
          De
          <input
            type="datetime-local"
            aria-label={`Início de ${titles[kind].toLowerCase()}`}
            value={filter.from}
            onChange={(e) => set("from", e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="datetime-local"
            aria-label={`Fim de ${titles[kind].toLowerCase()}`}
            value={filter.to}
            onChange={(e) => set("to", e.target.value)}
          />
        </label>
        <button
          className="secondary"
          onClick={() =>
            setFilter({ type: "", status: "", action: "", from: "", to: "" })
          }
        >
          Limpar filtros
        </button>
      </div>
      <p className="history-date-reference">
        Período por{" "}
        {kind === "events"
          ? "recebimento"
          : kind === "requests"
            ? "abertura"
            : "criação"}{" "}
        · 25 registros por página
      </p>
      {(invalid || records.error) && (
        <p role="alert" className="error">
          {invalid ? "O início deve ser anterior ao fim." : records.error}
        </p>
      )}
      <div
        className="table-scroll bounded-history"
        tabIndex={0}
        role="region"
        aria-label={`Tabela de ${titles[kind].toLowerCase()}`}
      >
        <table>
          <thead>
            <tr>
              <th>Leito / dispositivo</th>
              <th>Data</th>
              <th>{kind === "events" ? "Evento" : "Resultado"}</th>
              <th>Identificação e detalhes</th>
            </tr>
          </thead>
          <tbody>
            {records.items.map((row) => (
              <tr
                key={`${row.device_id}:${row.event_id ?? row.command_id ?? row.config_version ?? row.request_id}`}
              >
                <td>
                  {deviceNames[row.device_id] ?? row.device_id}
                  <small className="mono">{row.device_id}</small>
                </td>
                <td>
                  {date(
                    row.received_at ?? row.opened_at ?? row.created_at ?? null,
                  )}
                </td>
                <td>
                  {kind === "events"
                    ? (eventNames[row.type ?? ""] ?? row.type)
                    : row.status === "PENDING" && kind !== "requests"
                      ? "Em confirmação"
                      : (names[row.status ?? ""] ?? row.status)}
                  {row.reason && <small className="mono">{row.reason}</small>}
                </td>
                <td>
                  <details>
                    <summary>
                      {kind === "events"
                        ? "Ver evento"
                        : kind === "configs"
                          ? `Configuração v${row.config_version}`
                          : kind === "commands"
                            ? names[row.action ?? ""]
                            : "Ver chamado"}
                    </summary>
                    <p className="mono">
                      {row.event_id ??
                        row.command_id ??
                        row.request_id ??
                        `v${row.config_version}`}
                    </p>
                    {row.request_id && (
                      <p className="mono">Chamado: {row.request_id}</p>
                    )}
                    {kind === "events" && (
                      <p>
                        Horário no dispositivo: {date(row.occurred_at ?? null)}
                        <br />
                        Boot: {String(row.payload?.bootId ?? "—")}
                        <br />
                        Tempo em execução:{" "}
                        {String(row.payload?.uptimeMs ?? "—")} ms
                        <br />
                        Acionamentos: {String(row.payload?.pressCount ?? "—")}
                      </p>
                    )}
                    {kind === "requests" && (
                      <p>
                        Acionamentos: {row.press_count}
                        <br />
                        Última alteração: {date(row.updated_at ?? null)}
                      </p>
                    )}
                    {kind === "commands" && (
                      <p>Validade: {date(row.expires_at ?? null)}</p>
                    )}
                    {kind === "configs" && (
                      <p>
                        {names[String(row.payload?.mode)]} ·{" "}
                        {String(row.payload?.brightnessPct)}%<br />
                        Agenda: {String(row.payload?.startTime)}–
                        {String(row.payload?.endTime)}
                        <br />
                        Prazo: {String(row.payload?.offDelaySec)} s ·{" "}
                        {String(row.payload?.timezone)}
                      </p>
                    )}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!records.loading && !records.items.length && (
          <p className="empty">Nenhum registro para esta consulta.</p>
        )}
      </div>
      <div className="history-pagination">
        <span>
          Página {records.index + 1} · {records.items.length} registros
        </span>
        <button
          className="secondary"
          disabled={records.loading || !records.hasPrevious}
          onClick={records.previous}
        >
          Anterior
        </button>
        <button
          className="secondary"
          disabled={records.loading || !records.hasNext}
          onClick={records.next}
        >
          Próxima
        </button>
        <button
          disabled={records.loading || invalid || !scope}
          onClick={records.refresh}
        >
          Atualizar consulta
        </button>
        {records.loading && <span role="status">Carregando…</span>}
      </div>
    </div>
  );
}
export function HistoryView({
  deviceId,
  active,
  deviceNames,
}: {
  deviceId: string;
  active: boolean;
  deviceNames: Record<string, string>;
}) {
  const [all, setAll] = useState(false),
    [tab, setTab] = useState<Kind>("events");
  const scope = all ? "all" : deviceId;
  return (
    <div className="history-page">
      <div className="history-scope">
        <label>
          Abrangência do histórico
          <Select
            label="Abrangência do histórico"
            value={all ? "all" : "selected"}
            onValueChange={(v) => setAll(v === "all")}
            options={[
              { value: "selected", label: "Dispositivo selecionado" },
              { value: "all", label: "Todos os dispositivos" },
            ]}
          />
        </label>
        <HelpTooltip label="Consulta de históricos">
          Do mais recente para o mais antigo. As páginas ficam preservadas até
          atualizar a consulta; novas atividades não deslocam a leitura. Os
          filtros de cada coleção são independentes.
        </HelpTooltip>
      </div>
      <div className="history-grid">
        <section className="card">
          <div className="section-title">
            <div>
              <p className="eyebrow">ATIVIDADES</p>
              <h2>Histórico de registros</h2>
            </div>
          </div>
          <div
            className="history-tabs"
            role="group"
            aria-label="Coleção de registros"
          >
            {(["events", "requests", "configs"] as const).map((kind) => (
              <button
                key={kind}
                className={tab === kind ? "" : "secondary"}
                aria-pressed={tab === kind}
                onClick={() => setTab(kind)}
              >
                {titles[kind]}
              </button>
            ))}
          </div>
          {(["events", "requests", "configs"] as const).map((kind) => (
            <Collection
              key={kind}
              kind={kind}
              scope={scope}
              active={active && tab === kind}
              deviceNames={deviceNames}
            />
          ))}
        </section>
        <section className="card">
          <div className="section-title">
            <div>
              <p className="eyebrow">ATENDIMENTO</p>
              <h2>Histórico de comandos</h2>
            </div>
          </div>
          <Collection
            kind="commands"
            scope={scope}
            active={active}
            deviceNames={deviceNames}
          />
        </section>
      </div>
    </div>
  );
}
