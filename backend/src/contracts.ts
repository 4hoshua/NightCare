import { z } from 'zod';

export const DEVICE = 'nightcare-001';
export const PREFIX = `nightcare/${DEVICE}/`;

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w-]+$/);
const iso = z.iso.datetime();
const base = { schemaVersion: z.literal(1), deviceId: z.literal(DEVICE) };
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const settingsSchema = z
  .object({
    mode: z.enum(['AUTO', 'ON', 'OFF']),
    brightnessPct: z.number().int().min(1).max(100),
    offDelaySec: z.number().int().min(1).max(600),
    startTime: hhmm,
    endTime: hhmm,
    timezone: z.literal('America/Sao_Paulo'),
  })
  .strict();

export const configSchema = settingsSchema.extend({
  ...base,
  configVersion: z.number().int().min(1).max(2147483647),
});

export const eventSchema = z
  .object({
    ...base,
    eventId: id,
    bootId: id,
    type: z.enum([
      'BOOT',
      'MOTION_STARTED',
      'MOTION_ENDED',
      'LIGHT_ON',
      'LIGHT_OFF',
      'HELP_OPENED',
      'HELP_REITERATED',
      'HELP_ACKNOWLEDGED',
      'HELP_CLOSED',
      'HELP_RECOVERED',
      'CONFIG_APPLIED',
    ]),
    occurredAt: iso.nullable(),
    uptimeMs: z.number().int().nonnegative(),
    requestId: id.nullable(),
    pressCount: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((v) => !v.type.startsWith('HELP_') || v.requestId !== null);

export const stateSchema = z
  .object({
    ...base,
    bootId: id,
    sequence: z.number().int().nonnegative(),
    uptimeMs: z.number().int().nonnegative(),
    mode: z.enum(['AUTO', 'ON', 'OFF']),
    lightOn: z.boolean(),
    brightnessPct: z.number().int().min(1).max(100),
    motion: z.boolean(),
    assistanceStatus: z.enum(['NONE', 'PENDING', 'ACKNOWLEDGED']),
    requestId: id.nullable(),
    pressCount: z.number().int().nonnegative(),
    clockValid: z.boolean(),
    appliedConfigVersion: z.number().int().nonnegative(),
    droppedEvents: z.number().int().nonnegative(),
    persistenceOk: z.boolean(),
  })
  .strict()
  .refine((v) => (v.assistanceStatus === 'NONE') === (v.requestId === null));

export const availabilitySchema = z
  .object({ ...base, status: z.enum(['online', 'offline']) })
  .strict();

export const ackSchema = z
  .object({
    ...base,
    commandId: id.optional(),
    requestId: id.nullable().optional(),
    configVersion: z.number().int().positive().optional(),
    status: z.enum(['APPLIED', 'REJECTED']),
    reason: z.string().min(1).max(120),
  })
  .strict()
  .refine((v) => Boolean(v.commandId) !== Boolean(v.configVersion));

export const commandInput = z
  .object({ commandId: id, requestId: id, action: z.enum(['ACK_HELP', 'CLOSE_HELP']) })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;
export type CommandInput = z.infer<typeof commandInput>;
