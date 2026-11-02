import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Settings = {
  mode: "AUTO" | "ON" | "OFF";
  brightnessPct: number;
  offDelaySec: number;
  startTime: string;
  endTime: string;
  timezone: string;
};
type State = {
  mode: string;
  lightOn: boolean;
  brightnessPct: number;
  motion: boolean;
  assistanceStatus: "NONE" | "PENDING" | "ACKNOWLEDGED";
  requestId: string | null;
  clockValid: boolean;
  appliedConfigVersion: number;
  droppedEvents: number;
  persistenceOk: boolean;
};
type Command = {
  command_id: string;
  request_id: string;
  action: string;
  status: string;
  reason: string | null;
  expires_at: number;
};
type Snapshot = {
  eventCount: number;
  brokerConnected: boolean;
  device: { online: boolean; state: State | null; lastSeen: number | null };
  configs: {
    config_version: number;
    payload: Settings;
    status: string;
    reason: string | null;
  }[];
  requests: { request_id: string; opened_at: number | null; status: string }[];
  commands: Command[];
};
type EventRow = {
  event_id: string;
  type: string;
  request_id: string | null;
  occurred_at: string | null;
  received_at: number;
};
const defaults: Settings = {
  mode: "AUTO",
  brightnessPct: 30,
  offDelaySec: 30,
  startTime: "22:00",
  endTime: "06:00",
  timezone: "America/Sao_Paulo",
};
const names: Record<string, string> = {
  AUTO: "Automático",
  ON: "Ligado",
  OFF: "Desligado",
  NONE: "Sem chamado",
  PENDING: "Aguardando atendimento",
  ACKNOWLEDGED: "Reconhecido",
  APPLIED: "Confirmado",
  REJECTED: "Recusado",
  UNCONFIRMED: "Não confirmado",
  ACK_HELP: "Reconhecer",
  CLOSE_HELP: "Encerrar",
};
const eventNames: Record<string, string> = {
  BOOT: "Inicialização",
  MOTION_STARTED: "Movimento detectado",
  MOTION_ENDED: "Fim do movimento",
  LIGHT_ON: "Luz acesa",
  LIGHT_OFF: "Luz apagada",
  HELP_OPENED: "Chamado aberto",
  HELP_REITERATED: "Ajuda reiterada",
  HELP_ACKNOWLEDGED: "Chamado reconhecido",
  HELP_CLOSED: "Chamado encerrado",
  HELP_RECOVERED: "Chamado recuperado",
  CONFIG_APPLIED: "Configuração aplicada",
};
const date = (value: number | string | null) =>
  value === null ? "Sem registro" : new Date(value).toLocaleString("pt-BR");
const errorNames: Record<string, string> = {
  DEVICE_OFFLINE: "Dispositivo offline.",
  CLOCK_INVALID: "Aguarde NTP e retorne a hora real no ESP32.",
  REQUEST_MISMATCH: "O chamado mudou. Aguarde a atualização.",
  INVALID_TRANSITION: "A ação não corresponde ao estado atual.",
  UNAUTHORIZED: "Token inválido.",
  INVALID_PAYLOAD: "Confira os campos e seus limites.",
};
function App() {
  const [demo, setDemo] = useState<boolean | null>(null),
    [token, setToken] = useState(""),
    [tokenInput, setTokenInput] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [connected, setConnected] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState<Settings>(defaults),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [sending, setSending] = useState(false),
    [notice, setNotice] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]),
    [filter, setFilter] = useState({ type: "", from: "", to: "" }),
    [historyError, setHistoryError] = useState("");
  const [sound, setSound] = useState(false),
    [now, setNow] = useState(Date.now());
  const audio = useRef<AudioContext | null>(null),
    statusRef = useRef(false),
    initialized = useRef(false);
  const state = snapshot?.device.state;
  useEffect(() => {
    fetch("/ui-config")
      .then((r) => r.json())
      .then((v) => setDemo(v.demo))
      .catch(() => setError("Não foi possível conectar ao backend."));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  async function api(path: string, body?: unknown, signal?: AbortSignal) {
    const r = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(demo ? {} : { Authorization: `Bearer ${token}` }),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const data = await r.json();
    if (!r.ok)
      throw new Error(
        errorNames[data.error] ?? data.error ?? "Falha na solicitação.",
      );
    return data;
  }
  useEffect(() => {
    if (demo === null || (!demo && !token)) return;
    let active = true,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined;
    function connect() {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.onopen = () => {
        if (!demo) socket?.send(JSON.stringify({ type: "auth", token }));
      };
      socket.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data);
          if (message.type === "snapshot" && active) {
            setSnapshot(message.data);
            setConnected(true);
            setError("");
          }
        } catch {
          setError("Resposta inválida do painel.");
        }
      };
      socket.onclose = (e) => {
        if (!active) return;
        setConnected(false);
        if (e.code === 1008) {
          setError("Token inválido ou não informado.");
          return;
        }
        retry = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    }
    connect();
    return () => {
      active = false;
      clearTimeout(retry);
      socket?.close();
    };
  }, [demo, token]);
  useEffect(() => {
    if (!snapshot || initialized.current) return;
    const desired = snapshot.configs[0]?.payload;
    if (desired) setForm({ ...defaults, ...desired });
    initialized.current = true;
  }, [snapshot]);
  useEffect(() => {
    if (demo === null || (!demo && !token) || !snapshot) return;
    const abort = new AbortController();
    async function load() {
      try {
        if (filter.from && filter.to && filter.from > filter.to)
          throw new Error("O início deve ser anterior ao fim.");
        const params = new URLSearchParams({ limit: "100" });
        if (filter.type) params.set("type", filter.type);
        if (filter.from)
          params.set("from", new Date(filter.from).toISOString());
        if (filter.to) params.set("to", new Date(filter.to).toISOString());
        const result = await api(
          "/api/events?" + params,
          undefined,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setEvents(result);
          setHistoryError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) setHistoryError((e as Error).message);
      }
    }
    void load();
    return () => abort.abort();
  }, [demo, token, snapshot?.eventCount, connected, filter]);
  statusRef.current = !!connected && state?.assistanceStatus === "PENDING";
  useEffect(() => {
    if (!sound) return;
    const beep = () => {
      const ctx = audio.current;
      if (!statusRef.current || !ctx || ctx.state !== "running") return;
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    };
    beep();
    const t = setInterval(beep, 5000);
    return () => clearInterval(t);
  }, [sound]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function toggleSound() {
    if (sound) {
      setSound(false);
      return;
    }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setSound(true);
    } catch {
      setError("O navegador não permitiu o áudio.");
    }
  }
  const request = snapshot?.requests.find(
    (r) => r.request_id === state?.requestId,
  );
  const wait = request?.opened_at
    ? Math.max(0, Math.floor((now - request.opened_at) / 1000))
    : null;
  const action =
    state?.assistanceStatus === "PENDING" ? "ACK_HELP" : "CLOSE_HELP";
  const busy = snapshot?.commands.some(
    (c) =>
      c.request_id === state?.requestId &&
      c.action === action &&
      c.status !== "REJECTED" &&
      c.expires_at > now,
  );
  const canAct =
    connected &&
    snapshot?.device.online &&
    state?.clockValid &&
    !sending &&
    !busy;
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        mode: form.mode,
        brightnessPct: form.brightnessPct,
        offDelaySec: form.offDelaySec,
        startTime: form.startTime,
        endTime: form.endTime,
        timezone: form.timezone,
      };
      const result = await api("/api/config", payload);
      setDirty(false);
      setNotice(
        `Versão ${result.configVersion} enviada. Aguarde confirmação do ESP32.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function command(selected: string) {
    if (!state?.requestId) return;
    setSending(true);
    setError("");
    try {
      await api("/api/commands", {
        commandId: crypto.randomUUID(),
        requestId: state.requestId,
        action: selected,
      });
      setNotice("Comando enviado. Aguarde a confirmação do dispositivo.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <header>
        <div className="brand">
          <span className="moon">☾</span>
          <div>
            <strong>NightCare</strong>
            <small>Apoio ao deslocamento noturno</small>
          </div>
        </div>
        <span className="tag">
          MVP acadêmico{demo ? " · demonstração pública" : ""}
        </span>
      </header>
      <main>
        <div className="heading">
          <div>
            <p className="eyebrow">SUPERVISÃO DO AMBIENTE</p>
            <h1>Cuidado durante a noite</h1>
            <p>Dispositivo nightcare-001 · um ambiente</p>
          </div>
          <button className="secondary" onClick={toggleSound}>
            {sound ? "Desativar som" : "Ativar aviso sonoro"}
          </button>
        </div>
        {demo === false && (
          <form
            className="login"
            onSubmit={(e) => {
              e.preventDefault();
              setToken(tokenInput);
            }}
          >
            <label>
              Token da API{" "}
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <button>Conectar</button>
          </form>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {!connected && (
          <p role="alert" className="notice">
            {demo === null
              ? "Conectando ao backend…"
              : "Painel sem atualização ao vivo. Os valores exibidos podem estar desatualizados."}
          </p>
        )}
        <section className="metrics" aria-label="Estado do dispositivo">
          <article>
            <small>DISPOSITIVO</small>
            <strong
              className={
                connected && snapshot?.device.online ? "good" : "muted"
              }
            >
              {!snapshot
                ? "Aguardando dados"
                : connected && snapshot.device.online
                  ? "Online"
                  : "Offline / sem atualização"}
            </strong>
            <span>
              Última comunicação: {date(snapshot?.device.lastSeen ?? null)}
            </span>
          </article>
          <article>
            <small>ILUMINAÇÃO</small>
            <strong>
              {state ? (state.lightOn ? "Acesa" : "Apagada") : "—"}
            </strong>
            <span>
              {state
                ? `${state.brightnessPct}% · ${names[state.mode]}`
                : "Aguardando primeiro estado"}
            </span>
          </article>
          <article>
            <small>MOVIMENTO</small>
            <strong>
              {state ? (state.motion ? "Detectado" : "Sem movimento") : "—"}
            </strong>
            <span>
              Relógio:{" "}
              {state ? (state.clockValid ? "válido" : "inválido / teste") : "—"}
            </span>
          </article>
          <article>
            <small>COMUNICAÇÃO</small>
            <strong>
              {snapshot?.brokerConnected
                ? "Broker conectado"
                : "Broker desconectado"}
            </strong>
            <span>
              WebSocket: {connected ? "conectado" : "desconectado"} · perdas:{" "}
              {state?.droppedEvents ?? "—"}
            </span>
            <span>
              NVS:{" "}
              {state ? (state.persistenceOk ? "operacional" : "falha") : "—"}
            </span>
          </article>
        </section>
        <div className="columns">
          <section
            className={`card assistance ${state?.assistanceStatus === "PENDING" ? "pending" : ""}`}
          >
            <p className="eyebrow">ASSISTÊNCIA</p>
            <h2>
              {state ? names[state.assistanceStatus] : "Aguardando dispositivo"}
            </h2>
            {state?.requestId ? (
              <>
                <p className="request">Pedido {state.requestId}</p>
                <p>
                  Aberto há{" "}
                  {wait === null
                    ? "tempo desconhecido"
                    : `${Math.floor(wait / 60)} min ${wait % 60} s`}
                </p>
                <p>
                  {state.assistanceStatus === "PENDING"
                    ? "O botão foi acionado. Reconheça para indicar atendimento."
                    : "Atendimento reconhecido. Encerre quando concluído."}
                </p>
              </>
            ) : (
              <p>
                Os pedidos feitos no botão do ESP32 aparecem aqui e permanecem
                até o encerramento confirmado.
              </p>
            )}
            <div className="actions">
              <button
                disabled={!canAct || state?.assistanceStatus !== "PENDING"}
                onClick={() => command("ACK_HELP")}
              >
                Reconhecer
              </button>
              <button
                className="secondary"
                disabled={!canAct || state?.assistanceStatus !== "ACKNOWLEDGED"}
                onClick={() => command("CLOSE_HELP")}
              >
                Encerrar
              </button>
            </div>
            {state?.requestId && !state.clockValid && (
              <p className="hint">
                Aguarde NTP e use “hora real” no monitor serial para habilitar
                comandos.
              </p>
            )}
            {busy && (
              <p className="hint">
                Aguardando resultado ou atualização do estado. Sem resposta em
                10 s, o resultado fica não confirmado.
              </p>
            )}
            <div className="command-list">
              {snapshot?.commands.slice(0, 5).map((c) => (
                <div key={c.command_id}>
                  <strong>
                    {names[c.action]} ·{" "}
                    {c.status === "PENDING"
                      ? "Enviado"
                      : (names[c.status] ?? c.status)}
                  </strong>
                  <small>
                    {c.command_id}
                    {c.reason ? ` · ${c.reason}` : ""}
                  </small>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <p className="eyebrow">ILUMINAÇÃO E AGENDA</p>
            <h2>Configurar ambiente</h2>
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
            <div className="config-status">
              <p>
                Desejada:{" "}
                {snapshot?.configs[0]
                  ? `v${snapshot.configs[0].config_version} · ${snapshot.configs[0].status === "PENDING" ? "Aguardando confirmação" : names[snapshot.configs[0].status]}`
                  : "nenhuma configuração remota"}
              </p>
              {snapshot?.configs[0] && (
                <p className="hint">
                  Desejada: {names[snapshot.configs[0].payload.mode]} ·{" "}
                  {snapshot.configs[0].payload.brightnessPct}% ·{" "}
                  {snapshot.configs[0].payload.offDelaySec} s ·{" "}
                  {snapshot.configs[0].payload.startTime}–
                  {snapshot.configs[0].payload.endTime}
                </p>
              )}
              <p>
                Versão aplicada pelo ESP32: {state?.appliedConfigVersion ?? "—"}
              </p>
              {snapshot?.configs[0]?.reason && (
                <small>{snapshot.configs[0].reason}</small>
              )}
              <p className="hint">
                Os cartões mostram a saída atual. Alterações seriais podem
                diferir da última configuração remota.
              </p>
            </div>
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
                onChange={(e) =>
                  setFilter((f) => ({ ...f, to: e.target.value }))
                }
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
              Nenhum evento neste período. Inicie a simulação e acione o PIR ou
              o botão.
            </p>
          )}
        </section>
        <footer>
          Sistema acadêmico de apoio. Avisos remotos dependem da conexão e do
          painel aberto.
          {demo && " Broker público: use somente dados fictícios."}
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
