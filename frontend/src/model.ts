export type Settings = {
  mode: "AUTO" | "ON" | "OFF";
  brightnessPct: number;
  offDelaySec: number;
  startTime: string;
  endTime: string;
  timezone: string;
};
export type State = {
  mode: "AUTO" | "ON" | "OFF";
  bootId: string;
  uptimeMs: number;
  sequence: number;
  pressCount: number;
  runtimeSettings?: {
    offDelaySec: number;
    startTime: string;
    endTime: string;
    timezoneOffsetHours: number;
  };
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
export type Command = {
  command_id: string;
  request_id: string;
  action: string;
  status: string;
  reason: string | null;
  expires_at: number;
};
export type Snapshot = {
  eventCount: number;
  appliedConfig?: Snapshot["configs"][number] | null;
  activeRequest?: {
    request_id: string;
    opened_at: number | null;
    status: string;
  } | null;
  brokerConnected: boolean;
  device: Device;
  configs: {
    config_version: number;
    payload: Settings;
    status: string;
    reason: string | null;
  }[];
  requests: { request_id: string; opened_at: number | null; status: string }[];
  commands: Command[];
};
export type EventRow = {
  payload?: { bootId: string; uptimeMs: number; pressCount?: number };
  device_id: string;
  event_id: string;
  type: string;
  request_id: string | null;
  occurred_at: string | null;
  received_at: number;
};
export const defaults: Settings = {
  mode: "AUTO",
  brightnessPct: 30,
  offDelaySec: 30,
  startTime: "22:00",
  endTime: "06:00",
  timezone: "America/Sao_Paulo",
};
export const names: Record<string, string> = {
  AUTO: "Automático",
  ON: "Ligado",
  OFF: "Desligado",
  NONE: "Sem chamado",
  CLOSED: "Encerrado",
  PENDING: "Aguardando atendimento",
  ACKNOWLEDGED: "Reconhecido",
  APPLIED: "Confirmado",
  REJECTED: "Recusado",
  UNCONFIRMED: "Não confirmado",
  ACK_HELP: "Reconhecer",
  CLOSE_HELP: "Encerrar",
};
export const eventNames: Record<string, string> = {
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
export const date = (value: number | string | null) =>
  value === null ? "Sem registro" : new Date(value).toLocaleString("pt-BR");
export const errorNames: Record<string, string> = {
  DEVICE_OFFLINE: "Dispositivo offline.",
  CLOCK_INVALID: "Aguarde NTP e retorne a hora real no ESP32.",
  REQUEST_MISMATCH: "O chamado mudou. Aguarde a atualização.",
  INVALID_TRANSITION: "A ação não corresponde ao estado atual.",
  ID_CONFLICT: "Este identificador já pertence a outra intenção.",
  INVALID_CURSOR: "A página não corresponde aos filtros. Atualize a consulta.",
  INVALID_PERIOD: "O início deve ser anterior ao fim.",
  DEVICE_REQUIRED: "Selecione explicitamente um dispositivo.",
  DEVICE_UNASSIGNED: "Associe o dispositivo a um leito antes de operar.",
  DEVICE_NOT_FOUND: "Dispositivo não encontrado.",
  DEVICE_ALREADY_ASSIGNED: "A associação é permanente e já foi realizada.",
  BED_NAME_CONFLICT: "Já existe um leito com esse nome.",
  BED_NOT_FOUND: "Leito não encontrado.",
  INVALID_PAYLOAD: "Confira os campos e seus limites.",
};

// Compatibilidade com navegadores sem randomUUID fora de contexto seguro.
export const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export async function api(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  method = "POST",
) {
  const r = await fetch(path, {
    method: body ? method : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
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

export type Device = {
  deviceId: string;
  bed: { id: number; name: string } | null;
  online: boolean;
  state: State | null;
  lastSeen: number | null;
};
export type Overview = {
  brokerConnected: boolean;
  devices: Device[];
  beds: { id: number; name: string; deviceId: string }[];
  snapshots: Record<string, Snapshot>;
};
