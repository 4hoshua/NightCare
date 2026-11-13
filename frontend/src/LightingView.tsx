import { useId, type CSSProperties, type FormEvent } from "react";
import { type Settings, type Snapshot, names } from "./model";
import { DeviceSignals } from "./DeviceSignals";
import { Freshness, ConfigurationDetails } from "./views";
import { Icon } from "./navigation";
import { TimePicker } from "./TimePicker";
import { LightingCharts } from "./LightingCharts";
import type { LightingPeriod } from "./lighting-model";
export function LightingView({
  snapshot,
  connected,
  active,
  form,
  dirty,
  saving,
  change,
  save,
  canConfigure,
  period,
  onPeriodChange,
  detailsOpen,
  onDetailsChange,
}: {
  snapshot: Snapshot | null;
  connected: boolean;
  active: boolean;
  form: Settings;
  dirty: boolean;
  saving: boolean;
  change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  save: (event: FormEvent) => void;
  canConfigure: boolean;
  period: LightingPeriod;
  onPeriodChange: (period: LightingPeriod) => void;
  detailsOpen: boolean;
  onDetailsChange: (open: boolean) => void;
}) {
  const state = snapshot?.device.state,
    live = connected && !!snapshot?.device.online;
  const modeId = useId(),
    brightnessId = useId();
  const desired = snapshot?.configs[0];
  return (
    <div className={`lighting-page ${active ? "is-active" : ""}`}>
      <section className="card lighting-state lighting-enter">
        <div>
          <p className="eyebrow">ESTADO DO AMBIENTE</p>
          <h2>
            {!state
              ? "Aguardando o primeiro estado."
              : state.lightOn
                ? "O caminho está iluminado."
                : "Iluminação em espera."}
          </h2>
          <Freshness snapshot={snapshot} connected={connected} />
          <p className="lighting-current">
            {state
              ? `Modo em uso: ${names[state.mode]} · Brilho configurado: ${state.brightnessPct}%`
              : "Os valores aparecem após o primeiro estado recebido."}
          </p>
          {state && !state.clockValid && (
            <span className="pill waiting">
              <Icon name="warning" /> Relógio inválido ou em teste
            </span>
          )}
        </div>
        <div data-signal-live={live}>
          <DeviceSignals
            state={state ?? null}
            fields={["lighting", "motion"]}
            className="lighting-signals"
          />
        </div>
      </section>
      <section className="card lighting-settings lighting-enter">
        <div className="section-title">
          <div>
            <p className="eyebrow">AJUSTES DE ILUMINAÇÃO</p>
            <h2>Uma configuração, no seu ritmo.</h2>
          </div>
          <span
            className={`pill ${dirty ? "waiting" : desired?.status === "APPLIED" ? "success" : "waiting"}`}
          >
            {dirty
              ? "Alterações não aplicadas"
              : desired
                ? `Último envio: ${desired.status === "PENDING" ? "aguardando confirmação" : names[desired.status]}`
                : "Nenhuma configuração enviada"}
          </span>
        </div>
        <form onSubmit={save}>
          <fieldset className="lighting-mode">
            <legend>Modo a aplicar</legend>
            <div className="lighting-mode-options">
              {(["AUTO", "ON", "OFF"] as const).map((mode) => (
                <label className="mode-option" key={mode}>
                  <input
                    type="radio"
                    name={modeId}
                    value={mode}
                    checked={form.mode === mode}
                    onChange={() => change("mode", mode)}
                  />
                  <span>
                    <Icon
                      name={
                        mode === "AUTO"
                          ? "moon"
                          : mode === "ON"
                            ? "light-on"
                            : "light-off"
                      }
                    />
                    {names[mode]}
                  </span>
                </label>
              ))}
            </div>
            <p className="hint">
              {form.mode === "AUTO"
                ? "Automático: movimento acende a luz dentro da agenda."
                : form.mode === "ON"
                  ? "Ligado: mantém a luz acesa no brilho configurado."
                  : "Desligado: mantém a luz apagada."}{" "}
              A mudança só é enviada ao aplicar.
            </p>
          </fieldset>
          <div className="lighting-form-grid">
            <div
              className="brightness-control"
              style={
                {
                  "--preview-level": form.brightnessPct / 100,
                  "--preview-halo": `${5 + form.brightnessPct * 0.3}px`,
                  "--range-progress": `${form.brightnessPct}%`,
                } as CSSProperties
              }
            >
              <div className="brightness-heading">
                <label htmlFor={brightnessId}>Brilho a aplicar</label>
                <output htmlFor={brightnessId}>{form.brightnessPct}%</output>
              </div>
              <div className="brightness-preview" aria-hidden="true">
                <span className="brightness-preview-lamp">
                  <Icon name="light-on" />
                </span>
              </div>
              <input
                id={brightnessId}
                aria-label="Brilho a aplicar"
                className="brightness-range"
                type="range"
                min={1}
                max={100}
                step={1}
                value={form.brightnessPct}
                onChange={(e) =>
                  change("brightnessPct", Number(e.target.value))
                }
              />
              <div className="brightness-limits" aria-hidden="true">
                <span>1%</span>
                <span>100%</span>
              </div>
              <p className="hint">
                Prévia local de brilho. A lâmpada acima não representa uma
                mudança já aplicada ao dispositivo.
              </p>
            </div>
            <div className="lighting-schedule">
              <label>
                Prazo após movimento (s)
                <input
                  type="number"
                  min={1}
                  max={600}
                  required
                  value={form.offDelaySec}
                  onChange={(e) =>
                    change("offDelaySec", Number(e.target.value))
                  }
                />
              </label>
              <div className="time-pair">
                <label>
                  Início da agenda
                  <TimePicker
                    label="Início da agenda"
                    value={form.startTime}
                    onChange={(value) => change("startTime", value)}
                    active={active}
                  />
                </label>
                <label>
                  Fim da agenda
                  <TimePicker
                    label="Fim da agenda"
                    value={form.endTime}
                    onChange={(value) => change("endTime", value)}
                    active={active}
                  />
                </label>
              </div>
              <p className="hint">
                São Paulo · UTC−3.{" "}
                {form.startTime === form.endTime
                  ? "Horários iguais: agenda de 24 horas."
                  : "A agenda pode atravessar a meia-noite."}{" "}
                O botão de ajuda funciona a qualquer hora.
              </p>
            </div>
          </div>
          <div className="lighting-apply">
            <button disabled={saving || !connected || !canConfigure}>
              {saving ? "Enviando…" : "Aplicar configuração"}
              <Icon name="arrow" />
            </button>
            <p className="hint">
              {!canConfigure
                ? "Associe o dispositivo a um leito para configurar."
                : !connected
                  ? "Aguarde a conexão para enviar."
                  : "Envia modo, brilho, prazo e agenda juntos. A aplicação depende da confirmação do dispositivo."}
            </p>
          </div>
        </form>
        <details
          className="lighting-details"
          open={detailsOpen}
          onToggle={(event) => {
            if (event.currentTarget.open !== detailsOpen)
              onDetailsChange(event.currentTarget.open);
          }}
        >
          <summary>
            <Icon name="settings" />
            {detailsOpen ? "Ocultar detalhes" : "Ver detalhes"}
            <Icon name="expand" />
          </summary>
          <div className="configuration-detail-body">
            <ConfigurationDetails snapshot={snapshot} connected={connected} />
          </div>
        </details>
      </section>
      <LightingCharts
        snapshot={snapshot}
        connected={connected}
        active={active}
        period={period}
        onPeriodChange={onPeriodChange}
      />
    </div>
  );
}
