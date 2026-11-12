import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { commandInput, settingsSchema } from './contracts.js';
import { Store } from './store.js';

export async function buildApp(
  store: Store,
  token: string,
  brokerConnected: () => boolean = () => false,
) {
  if (token.length < 32) throw new Error('API_TOKEN requires at least 32 characters');

  const app = Fastify({ logger: { redact: ['req.headers.authorization'] }, bodyLimit: 8192 });

  const equal = (value: unknown) =>
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));

  app.addHook('onRequest', async (req, reply) => {
    if (
      req.routeOptions.url?.startsWith('/api/') &&
      !equal(req.headers.authorization?.replace(/^Bearer /, ''))
    )
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: 'INVALID_PAYLOAD', details: error.issues });

    const e = error as Error & { statusCode?: number };
    if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
    if (
      /^(ID_CONFLICT|DEVICE_OFFLINE|CLOCK_INVALID|REQUEST_MISMATCH|INVALID_TRANSITION)$/.test(
        e.message,
      )
    )
      return reply.code(409).send({ error: e.message });

    req.log.error(error);

    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_, reply) => {
    store.db.prepare('SELECT 1').get();
    return reply
      .code(brokerConnected() ? 200 : 503)
      .send({ sqlite: true, mqtt: brokerConnected() });
  });

  app.get('/api/status', async () => ({ ...store.snapshot(), brokerConnected: brokerConnected() }));

  app.get('/api/events', async (req) =>
    store.history(
      z
        .object({
          limit: z.coerce.number().int().min(1).max(500).optional(),
          type: z.string().max(64).optional(),
          from: z.iso.datetime().optional(),
          to: z.iso.datetime().optional(),
        })
        .strict()
        .parse(req.query),
    ),
  );

  app.post('/api/config', async (req, reply) =>
    reply.code(202).send(await store.setConfig(settingsSchema.parse(req.body))),
  );

  app.post('/api/commands', async (req, reply) =>
    reply.code(202).send(await store.command(commandInput.parse(req.body))),
  );

  app.get('/api/commands/:id', async (req, reply) => {
    const id = z.object({ id: z.string().max(120) }).parse(req.params).id;
    const c = store.getCommand(id);

    return c ?? reply.code(404).send({ error: 'NOT_FOUND' });
  });

  return app;
}
