import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, Lightbulb, LogOut, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  ApiError,
  api,
  getToken,
  newId,
  setToken,
  type EventRow,
  type Mode,
  type Settings,
  type Status,
} from '@/lib/api';

const MODES: Mode[] = ['AUTO', 'ON', 'OFF'];
const MODE_LABEL: Record<Mode, string> = {
  AUTO: 'Automático',
  ON: 'Sempre ligada',
  OFF: 'Desligada',
};

const EVENT_LABEL: Record<string, string> = {
  BOOT: 'Dispositivo iniciado',
  MOTION_STARTED: 'Movimento detectado',
  MOTION_ENDED: 'Movimento encerrado',
  LIGHT_ON: 'Luz ligada',
  LIGHT_OFF: 'Luz desligada',
  HELP_OPENED: 'Pedido de ajuda',
  HELP_REITERATED: 'Pedido de ajuda reiterado',
  HELP_ACKNOWLEDGED: 'Atendimento reconhecido',
  HELP_CLOSED: 'Pedido encerrado',
  HELP_RECOVERED: 'Pedido recuperado após reinício',
  CONFIG_APPLIED: 'Configuração aplicada',
};

const DEFAULTS: Settings = {
  mode: 'AUTO',
  brightnessPct: 30,
  offDelaySec: 30,
  startTime: '22:00',
  endTime: '06:00',
  timezone: 'America/Sao_Paulo',
};

// Última configuração enviada; sem nenhuma, usa os padrões do firmware.
function currentSettings(status: Status): Settings {
  const p = status.configs[0]?.payload;
  const s = status.device.state;
  return {
    mode: p?.mode ?? s?.mode ?? DEFAULTS.mode,
    brightnessPct: p?.brightnessPct ?? s?.brightnessPct ?? DEFAULTS.brightnessPct,
    offDelaySec: p?.offDelaySec ?? DEFAULTS.offDelaySec,
    startTime: p?.startTime ?? DEFAULTS.startTime,
    endTime: p?.endTime ?? DEFAULTS.endTime,
    timezone: 'America/Sao_Paulo',
  };
}

function beep(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

export default function App() {
  const [token, setTokenState] = useState(getToken());
  const logout = useCallback(() => {
    setToken('');
    setTokenState('');
  }, []);

  if (!token) {
    return (
      <Login
        onLogin={(t) => {
          setToken(t);
          setTokenState(t);
        }}
      />
    );
  }
  return <Dashboard onLogout={logout} />;
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>NightCare</CardTitle>
          <p className="text-sm text-muted-foreground">
            Informe o token da API para acessar o painel.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) onLogin(value.trim());
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              placeholder="API_TOKEN"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button type="submit">Entrar</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api<Status>('status'), api<EventRow[]>('events?limit=20')]);
      setStatus(s);
      setEvents(e);
      setOffline(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onLogout();
      setOffline(true);
    }
  }, [onLogout]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (status && !draft) setDraft(currentSettings(status));
  }, [status, draft]);

  const state = status?.device.state ?? null;
  const help = state?.assistanceStatus ?? 'NONE';

  // Alerta sonoro enquanto houver pedido aguardando atendimento
  useEffect(() => {
    const ctx = audio.current;
    if (!sound || help !== 'PENDING' || !ctx) return;
    beep(ctx);
    const timer = setInterval(() => beep(ctx), 2000);
    return () => clearInterval(timer);
  }, [sound, help]);

  function toggleSound() {
    audio.current ??= new AudioContext(); // precisa nascer de um clique do usuário
    setSound((on) => !on);
  }

  async function run(action: () => Promise<unknown>, okText: string) {
    try {
      await action();
      setNotice({ ok: true, text: okText });
      await refresh();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Falha na requisição.',
      });
    }
  }

  const saveConfig = (settings: Settings) =>
    run(
      () => api('config', { method: 'POST', body: JSON.stringify(settings) }),
      'Configuração enviada ao dispositivo.',
    );

  const sendCommand = (action: 'ACK_HELP' | 'CLOSE_HELP', requestId: string) =>
    run(
      () =>
        api('commands', {
          method: 'POST',
          body: JSON.stringify({ commandId: newId(), requestId, action }),
        }),
      action === 'ACK_HELP' ? 'Atendimento reconhecido.' : 'Pedido encerrado.',
    );

  function changeMode(mode: Mode) {
    if (!status) return;
    setDraft((d) => d && { ...d, mode });
    void saveConfig({ ...currentSettings(status), mode });
  }

  function submitParams(e: FormEvent) {
    e.preventDefault();
    if (draft) void saveConfig(draft);
  }

  if (!status || !draft) {
    return (
      <main className="p-6 text-sm text-muted-foreground">
        {offline ? 'Sem conexão com o backend.' : 'Carregando…'}
      </main>
    );
  }

  const online = status.device.online;
  const latest = status.configs[0];
  const activeMode = state?.mode ?? currentSettings(status).mode;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">NightCare</h1>
          <Badge variant={online ? 'default' : 'destructive'}>
            {online ? <Wifi /> : <WifiOff />}
            {online ? 'Dispositivo online' : 'Dispositivo offline'}
          </Badge>
          {offline && <Badge variant="destructive">Sem conexão com o backend</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={toggleSound}>
            {sound ? <Volume2 /> : <VolumeX />}
            Alerta sonoro {sound ? 'ligado' : 'desligado'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut /> Sair
          </Button>
        </div>
      </header>

      {notice && (
        <p className={notice.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>
          {notice.text}
        </p>
      )}

      {state && help !== 'NONE' && (
        <Card className="border-destructive bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Bell className="size-5" />
              {help === 'PENDING'
                ? 'Pedido de ajuda aguardando atendimento'
                : 'Atendimento reconhecido, aguardando encerramento'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              Pedido {state.requestId} · {state.pressCount} clique(s)
            </span>
            {help === 'PENDING' ? (
              <Button
                variant="destructive"
                onClick={() => sendCommand('ACK_HELP', state.requestId!)}
              >
                Reconhecer atendimento
              </Button>
            ) : (
              <Button onClick={() => sendCommand('CLOSE_HELP', state.requestId!)}>
                Encerrar pedido
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="size-4" /> Estado do dispositivo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Row label="Luz">
              {state ? (state.lightOn ? `Ligada · ${state.brightnessPct}%` : 'Desligada') : '—'}
            </Row>
            <Row label="Movimento">
              {state ? (state.motion ? 'Detectado' : 'Sem movimento') : '—'}
            </Row>
            <Row label="Pedido de ajuda">
              {{ NONE: 'Nenhum', PENDING: 'Aguardando', ACKNOWLEDGED: 'Reconhecido' }[help]}
            </Row>
            <Row label="Relógio">{state ? (state.clockValid ? 'Válido' : 'Inválido') : '—'}</Row>
            <Row label="Broker MQTT">{status.brokerConnected ? 'Conectado' : 'Desconectado'}</Row>
            <Row label="Configuração">
              {latest
                ? `v${latest.config_version} · ${latest.status}${latest.reason ? ` (${latest.reason})` : ''}`
                : 'Padrões do firmware'}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Modo de funcionamento</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <Button
                  key={m}
                  variant={m === activeMode ? 'default' : 'outline'}
                  onClick={() => changeMode(m)}
                >
                  {MODE_LABEL[m]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Automático acende a luz com movimento dentro do horário configurado.
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Parâmetros</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
              onSubmit={submitParams}
            >
              <label className="flex flex-col gap-1 text-sm">
                Brilho (%)
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.brightnessPct}
                  onChange={(e) => setDraft({ ...draft, brightnessPct: Number(e.target.value) })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Desligar após (s)
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={draft.offDelaySec}
                  onChange={(e) => setDraft({ ...draft, offDelaySec: Number(e.target.value) })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Início
                <Input
                  type="time"
                  value={draft.startTime}
                  onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Fim
                <Input
                  type="time"
                  value={draft.endTime}
                  onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                />
              </label>
              <Button type="submit">Enviar</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Histórico recente</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p>
            )}
            {events.map((ev) => (
              <Row key={ev.event_id} label={new Date(ev.received_at).toLocaleString('pt-BR')}>
                <span className={ev.type.startsWith('HELP_') ? 'text-destructive' : undefined}>
                  {EVENT_LABEL[ev.type] ?? ev.type}
                </span>
              </Row>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
