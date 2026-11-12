import { useEffect, useRef, useState } from "react";
import { api, date, names, type Snapshot } from "./model";

export type Records<T> = {
  items: T[];
  loading: boolean;
  error: string;
  nextCursor: string | null;
  loadMore: () => void;
  refresh: () => void;
};
export function useRecords<T>(
  kind: string,
  query: string | null,
  revision: string,
): Records<T> {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const expanded = useRef(false),
    previousQuery = useRef<string | null | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  async function load(cursor?: string) {
    controller.current?.abort();
    if (query === null) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(query);
      params.set("page", "true");
      params.set("limit", "100");
      if (cursor) params.set("cursor", cursor);
      const page = await api(`/api/${kind}?${params}`, undefined, abort.signal);
      if (!abort.signal.aborted) {
        setItems((old) => (cursor ? [...old, ...page.items] : page.items));
        setNext(page.nextCursor);
        if (cursor) expanded.current = true;
      }
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    if (previousQuery.current !== `${kind}?${query}`) {
      expanded.current = false;
      previousQuery.current = `${kind}?${query}`;
      setItems([]);
      setNext(null);
    }
    // Do not move an operator back to page one while reading older records.
    if (!expanded.current) void load();
  }, [kind, query, revision, refreshCount]);
  useEffect(() => () => controller.current?.abort(), []);
  return {
    items,
    nextCursor,
    loading,
    error,
    loadMore: () => {
      if (nextCursor && !loading) {
        expanded.current = true;
        void load(nextCursor);
      }
    },
    refresh: () => {
      expanded.current = false;
      setRefreshCount((n) => n + 1);
    },
  };
}
export function RecordControls({ records }: { records: Records<unknown> }) {
  return (
    <div className="record-controls">
      <span>{records.items.length} registros carregados</span>
      <button
        className="secondary"
        type="button"
        disabled={records.loading}
        onClick={records.refresh}
      >
        Atualizar consulta
      </button>
      {records.nextCursor && (
        <button
          type="button"
          disabled={records.loading}
          onClick={records.loadMore}
        >
          Carregar mais
        </button>
      )}
      {records.loading && <span role="status">Carregando registros…</span>}
    </div>
  );
}
type StoredRow = {
  device_id: string;
  request_id?: string;
  command_id?: string;
  config_version?: number;
  opened_at?: number | null;
  created_at?: number;
  updated_at?: number;
  expires_at?: number;
  status: string;
  action?: string;
  reason?: string | null;
  press_count?: number;
  payload?: {
    mode?: string;
    brightnessPct?: number;
    offDelaySec?: number;
    startTime?: string;
    endTime?: string;
    timezone?: string;
  };
};
function ArchiveList({
  kind,
  title,
  revision,
  scope,
  deviceNames,
}: {
  kind: string;
  title: string;
  revision: string;
  scope: string;
  deviceNames: Record<string, string>;
}) {
  const records = useRecords<StoredRow>(
    scope === "all" ? kind : `devices/${scope}/${kind}`,
    scope === "all" ? "scope=all" : scope ? "" : null,
    revision,
  );
  return (
    <section className="card archive-list">
      <h2>{title}</h2>
      <p className="hint">
        Do mais recente para o mais antigo. Ao carregar páginas antigas, use
        Atualizar consulta para voltar aos registros recentes.
      </p>
      {records.error && (
        <p role="alert" className="error">
          {records.error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Leito / dispositivo</th>
              <th>Identificador</th>
              <th>Data</th>
              <th>Resultado</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {records.items.map((row) => (
              <tr
                key={`${row.device_id}/${row.command_id ?? row.config_version ?? row.request_id}`}
              >
                <td>{deviceNames[row.device_id] ?? row.device_id}</td>
                <td className="request">
                  {row.command_id ??
                    (row.config_version
                      ? `v${row.config_version}`
                      : row.request_id)}
                </td>
                <td>{date(row.opened_at ?? row.created_at ?? null)}</td>
                <td>
                  {row.status === "PENDING" && kind !== "requests"
                    ? "Em confirmação"
                    : (names[row.status] ?? row.status)}
                  {row.reason && <p className="mono">{row.reason}</p>}
                </td>
                <td>
                  {kind === "requests" ? (
                    <>
                      {row.press_count} acionamento(s)
                      <br />
                      Última alteração: {date(row.updated_at ?? null)}
                    </>
                  ) : kind === "commands" ? (
                    <>
                      {names[row.action!] ?? row.action}
                      <br />
                      <span className="mono">Chamado: {row.request_id}</span>
                      <br />
                      Validade: {date(row.expires_at ?? null)}
                    </>
                  ) : (
                    <>
                      {names[row.payload?.mode ?? ""]} ·{" "}
                      {row.payload?.brightnessPct}%<br />
                      Agenda: {row.payload?.startTime}–{row.payload?.endTime}
                      <br />
                      Prazo: {row.payload?.offDelaySec} s ·{" "}
                      {row.payload?.timezone}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!records.loading && !records.items.length && (
        <p className="empty">Nenhum registro disponível.</p>
      )}
      <RecordControls records={records} />
    </section>
  );
}
export function ArchiveLists({
  snapshot,
  connected,
  scope,
  deviceNames,
  revision,
}: {
  snapshot: Snapshot | null;
  connected: boolean;
  scope: string;
  deviceNames: Record<string, string>;
  revision?: string;
}) {
  return (
    <div className="archive-lists">
      <ArchiveList
        kind="requests"
        title="Histórico de chamados"
        scope={scope}
        deviceNames={deviceNames}
        revision={revision ?? JSON.stringify([connected, snapshot?.requests])}
      />
      <ArchiveList
        kind="commands"
        title="Histórico de comandos"
        scope={scope}
        deviceNames={deviceNames}
        revision={revision ?? JSON.stringify([connected, snapshot?.commands])}
      />
      <ArchiveList
        kind="configs"
        title="Histórico de configurações"
        scope={scope}
        deviceNames={deviceNames}
        revision={revision ?? JSON.stringify([connected, snapshot?.configs])}
      />
    </div>
  );
}
