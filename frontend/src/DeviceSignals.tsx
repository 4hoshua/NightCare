import { names, type Device } from "./model";
import { Icon, type IconName } from "./navigation";

function Signal({
  label,
  icon,
  value,
  tone,
  kind,
}: {
  label: string;
  icon: IconName;
  value: string;
  tone:
    | "quiet"
    | "light"
    | "motion"
    | "pending"
    | "confirmed"
    | "warning"
    | "unknown";
  kind: "motion" | "lighting" | "assistance" | "clock";
}) {
  return (
    <div className={`bed-signal bed-signal-${kind} is-${tone}`}>
      <dt>
        <span className="bed-signal-icon">
          <Icon name={icon} />
        </span>
        <span>{label}</span>
      </dt>
      <dd className="bed-signal-value" key={value}>
        {value}
      </dd>
    </div>
  );
}
export function DeviceSignals({
  state,
  fields = ["motion", "lighting", "assistance", "clock"],
  className = "",
}: {
  state: Device["state"];
  fields?: ("motion" | "lighting" | "assistance" | "clock")[];
  className?: string;
}) {
  const help = state?.assistanceStatus;
  const signals = {
    motion: (
      <Signal
        key="motion"
        label="Movimento"
        kind="motion"
        icon={!state ? "unknown" : state.motion ? "motion" : "motion-idle"}
        tone={!state ? "unknown" : state.motion ? "motion" : "quiet"}
        value={
          !state
            ? "Sem informação"
            : state.motion
              ? "Detectado"
              : "Sem movimento"
        }
      />
    ),
    lighting: (
      <Signal
        key="lighting"
        label="Luz"
        kind="lighting"
        icon={!state ? "unknown" : state.lightOn ? "light-on" : "light-off"}
        tone={!state ? "unknown" : state.lightOn ? "light" : "quiet"}
        value={
          !state
            ? "Sem informação"
            : state.lightOn
              ? `Acesa · ${state.brightnessPct}%`
              : "Apagada"
        }
      />
    ),
    assistance: (
      <Signal
        key="assistance"
        label="Assistência"
        kind="assistance"
        icon={
          !state
            ? "unknown"
            : help === "PENDING"
              ? "help"
              : help === "ACKNOWLEDGED"
                ? "help-check"
                : "check"
        }
        tone={
          !state
            ? "unknown"
            : help === "PENDING"
              ? "pending"
              : help === "ACKNOWLEDGED"
                ? "confirmed"
                : "quiet"
        }
        value={state ? names[state.assistanceStatus] : "Sem informação"}
      />
    ),
    clock: (
      <Signal
        key="clock"
        label="Relógio"
        kind="clock"
        icon={!state ? "unknown" : state.clockValid ? "clock-check" : "warning"}
        tone={!state ? "unknown" : state.clockValid ? "confirmed" : "warning"}
        value={
          !state
            ? "Sem informação"
            : state.clockValid
              ? "Sincronizado"
              : "Inválido ou em teste"
        }
      />
    ),
  };
  return (
    <dl className={`bed-signals ${className}`}>
      {fields.map((field) => signals[field])}
    </dl>
  );
}
