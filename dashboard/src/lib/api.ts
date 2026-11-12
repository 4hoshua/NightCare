export type Mode = 'AUTO' | 'ON' | 'OFF';

export type Settings = {
  mode: Mode;
  brightnessPct: number;
  offDelaySec: number;
  startTime: string;
  endTime: string;
  timezone: 'America/Sao_Paulo';
};

export type DeviceState = {
  mode: Mode;
  lightOn: boolean;
  brightnessPct: number;
  motion: boolean;
  assistanceStatus: 'NONE' | 'PENDING' | 'ACKNOWLEDGED';
  requestId: string | null;
  pressCount: number;
  clockValid: boolean;
  appliedConfigVersion: number;
  persistenceOk: boolean;
  droppedEvents: number;
};

export type Status = {
  brokerConnected: boolean;
  device: { online: boolean; lastSeen: number | null; state: DeviceState | null };
  configs: { config_version: number; payload: Settings; status: string; reason: string | null }[];
  commands: { command_id: string; action: string; status: string; reason: string | null }[];
};

export type EventRow = {
  event_id: string;
  type: string;
  request_id: string | null;
  received_at: number;
};

const ERRORS: Record<string, string> = {
  UNAUTHORIZED: 'Token inválido.',
  INVALID_PAYLOAD: 'Valores inválidos. Confira brilho (1–100), tempo (1–600 s) e horários.',
  DEVICE_OFFLINE: 'O dispositivo está offline.',
  CLOCK_INVALID: 'O relógio do dispositivo ainda não é válido.',
  REQUEST_MISMATCH: 'O pedido mudou. Atualize e tente de novo.',
  INVALID_TRANSITION: 'Ação não permitida no estado atual do pedido.',
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'nightcare-token';
export const getToken = () => sessionStorage.getItem(TOKEN_KEY) ?? '';
export const setToken = (token: string) =>
  token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY);

// randomUUID só existe em contexto seguro (https ou localhost); o fallback atende o padrão [\w-]+
export const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (body as { error?: string }).error ?? '';
    throw new ApiError(res.status, ERRORS[code] ?? `Erro ${res.status}`);
  }
  return body as T;
}
