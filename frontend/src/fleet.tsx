import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, date, names, type Overview } from "./model";
export type FleetDeviceProps = {
  deviceId: string;
  active: boolean;
  overview: Overview | null;
  connected: boolean;
  sound: boolean;
  toggleSound: () => void;
  onSelect: (id: string, page?: string) => void;
  demo: boolean | null;
};
export function FleetApp({
  renderDevice,
}: {
  renderDevice: (props: FleetDeviceProps) => ReactNode;
}) {
  const [overview, setOverview] = useState<Overview | null>(null),
    [connected, setConnected] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("device") ?? "",
  );
  const [demo, setDemo] = useState<boolean | null>(null),
    [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null),
    pending = useRef(false);
  pending.current =
    connected &&
    !!overview?.devices.some(
      (d) =>
        d.state?.assistanceStatus === "PENDING" ||
        (!d.state &&
          overview.snapshots[d.deviceId]?.requests.some(
            (r) => r.status === "PENDING",
          )),
    );
  useEffect(() => {
    let active = true,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined;
    function connect() {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.onopen = () => {
        void fetch("/ui-config")
          .then((r) => r.json())
          .then((c) => {
            if (active) setDemo(c.demo);
          })
          .catch(() => {});
      };
      socket.onmessage = (e) => {
        try {
          const v = JSON.parse(e.data);
          if (active && v.type === "snapshot") {
            setOverview(v.data);
            setConnected(true);
            setError("");
          }
        } catch {
          setError("Resposta inválida do serviço.");
        }
      };
      socket.onclose = () => {
        if (active) {
          setConnected(false);
          retry = setTimeout(connect, 2000);
        }
      };
      socket.onerror = () => socket?.close();
    }
    connect();
    return () => {
      active = false;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
  useEffect(() => {
    if (!overview || overview.devices.some((d) => d.deviceId === selected))
      return;
    const first = overview.devices.find((d) => d.bed) ?? overview.devices[0];
    if (first) setSelected(first.deviceId);
  }, [overview, selected]);
  useEffect(() => {
    if (!selected) return;
    const url = new URL(location.href);
    url.searchParams.set("device", selected);
    history.replaceState(null, "", url);
  }, [selected]);
  useEffect(() => {
    if (!sound) return;
    const beep = () => {
      const ctx = audio.current;
      if (!pending.current || !ctx || ctx.state !== "running") return;
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
    const timer = setInterval(beep, 5000);
    return () => clearInterval(timer);
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
  useEffect(() => {
    const navigate = () =>
      setSelected(new URLSearchParams(location.search).get("device") ?? "");
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  function onSelect(id: string, page?: string) {
    setSelected(id);
    const url = new URL(location.href);
    url.searchParams.set("device", id);
    if (page) url.hash = page;
    if (url.href !== location.href) history.pushState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  const ids = overview?.devices.length
    ? overview.devices.map((d) => d.deviceId)
    : [""];
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {ids.map((id) => (
        <div
          key={id}
          hidden={overview?.devices.length ? id !== selected : false}
        >
          {renderDevice({
            deviceId: id,
            active: !overview?.devices.length || id === selected,
            overview,
            connected,
            sound,
            toggleSound,
            onSelect,
            demo,
          })}
        </div>
      ))}
    </>
  );
}
export function FleetAlerts({
  overview,
  connected,
  onSelect,
}: {
  overview: Overview | null;
  connected: boolean;
  onSelect: FleetDeviceProps["onSelect"];
}) {
  const calls =
    overview?.devices.filter(
      (d) =>
        !!d.state?.requestId ||
        (!d.state &&
          overview.snapshots[d.deviceId]?.requests.some(
            (r) => r.status !== "CLOSED",
          )),
    ) ?? [];
  if (!calls.length) return null;
  return (
    <section className="fleet-alerts" aria-label="Chamados em todos os leitos">
      <h2>{calls.length} chamado(s) ativo(s)</h2>
      {calls.map((d) => (
        <button
          className="secondary"
          key={d.deviceId}
          onClick={() =>
            onSelect(d.deviceId, d.bed ? "assistencia" : "administracao")
          }
        >
          {d.bed?.name ?? `Dispositivo sem leito · ${d.deviceId}`} ·{" "}
          {d.state ? names[d.state.assistanceStatus] : "Pedido recebido"}
          {!connected || !d.online ? " · última informação recebida" : ""}
        </button>
      ))}
    </section>
  );
}
export function FleetOverview({
  overview,
  connected,
  onSelect,
}: {
  overview: Overview | null;
  connected: boolean;
  onSelect: FleetDeviceProps["onSelect"];
}) {
  const devices = overview?.devices ?? [];
  return (
    <>
      <div className="bed-grid">
        {devices
          .filter((d) => d.bed)
          .map((d) => (
            <section className="card bed-card" key={d.deviceId}>
              <div className="section-title">
                <h2>{d.bed!.name}</h2>
                <span
                  className={`pill ${connected && d.online ? "success" : "waiting"}`}
                >
                  {connected && d.online ? "Online" : "Offline"}
                </span>
              </div>
              <p className="mono">{d.deviceId}</p>
              <dl className="detail-list">
                <div>
                  <dt>Movimento</dt>
                  <dd>
                    {d.state
                      ? d.state.motion
                        ? "Detectado"
                        : "Sem movimento"
                      : "Sem informação"}
                  </dd>
                </div>
                <div>
                  <dt>Luz</dt>
                  <dd>
                    {d.state
                      ? d.state.lightOn
                        ? `Acesa · ${d.state.brightnessPct}%`
                        : "Apagada"
                      : "Sem informação"}
                  </dd>
                </div>
                <div>
                  <dt>Assistência</dt>
                  <dd>
                    {d.state
                      ? names[d.state.assistanceStatus]
                      : "Sem informação"}
                  </dd>
                </div>
                <div>
                  <dt>Relógio</dt>
                  <dd>
                    {d.state
                      ? d.state.clockValid
                        ? "Sincronizado"
                        : "Inválido ou em teste"
                      : "Sem informação"}
                  </dd>
                </div>
              </dl>
              {(!connected || !d.online) && (
                <p className="hint">
                  Última informação recebida; sem atualização ao vivo.
                </p>
              )}
              <div className="actions">
                <button onClick={() => onSelect(d.deviceId, "iluminacao")}>
                  Abrir iluminação
                </button>
                <button
                  className="secondary"
                  onClick={() => onSelect(d.deviceId, "assistencia")}
                >
                  Assistência
                </button>
              </div>
            </section>
          ))}
      </div>
      {!devices.some((d) => d.bed) && (
        <section className="card">
          <h2>Nenhum leito associado</h2>
          <p>
            Inicie os dispositivos e confirme a associação na Administração.
          </p>
        </section>
      )}
      {!!devices.filter((d) => !d.bed).length && (
        <p className="notice">
          {devices.filter((d) => !d.bed).length} dispositivo(s) encontrado(s)
          sem leito. <a href="#administracao">Associar na Administração</a>
        </p>
      )}
    </>
  );
}
function DeviceRegistration({
  device,
  connected,
}: {
  device: NonNullable<Overview>["devices"][number];
  connected: boolean;
}) {
  const [name, setName] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (device.bed)
        await api(`/api/beds/${device.bed.id}`, { name }, undefined, "PATCH");
      else await api(`/api/devices/${device.deviceId}/assign`, { name });
      setName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className="device-registration">
      <h3>{device.bed?.name ?? "Dispositivo encontrado"}</h3>
      <p className="mono">{device.deviceId}</p>
      <p>
        {connected && device.online ? "Online" : "Offline"} · Última
        comunicação: {date(device.lastSeen)}
      </p>
      {device.state?.requestId && (
        <p className="notice">
          {names[device.state.assistanceStatus]} · {device.state.pressCount}{" "}
          acionamento(s)
        </p>
      )}
      <form onSubmit={submit}>
        <label>
          {device.bed ? "Corrigir nome do leito" : "Associar ao leito"}
          <input
            aria-label={`${device.bed ? "Novo nome" : "Nome do leito"} de ${device.deviceId}`}
            required
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          disabled={!connected || saving || (!device.bed && !device.online)}
        >
          {device.bed ? "Salvar nome" : "Confirmar associação"}
        </button>
      </form>
      {!device.bed && !device.online && (
        <p className="hint">
          Aguarde estado novo do dispositivo para confirmar a associação.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
export function FleetAdmin({
  overview,
  connected,
}: {
  overview: Overview | null;
  connected: boolean;
}) {
  return (
    <section className="card fleet-admin">
      <h2>Dispositivos e leitos</h2>
      <p className="hint">
        Confirme onde cada dispositivo foi instalado. A associação é permanente
        nesta versão; corrigir o nome não troca o dispositivo.
      </p>
      {!overview?.devices.length && (
        <p>
          Nenhum dispositivo encontrado. Inicie uma simulação com o pacote da
          instalação.
        </p>
      )}
      <div className="registration-grid">
        {overview?.devices.map((d) => (
          <DeviceRegistration
            key={d.deviceId}
            device={d}
            connected={connected}
          />
        ))}
      </div>
    </section>
  );
}
