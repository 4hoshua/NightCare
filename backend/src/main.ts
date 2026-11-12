import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import mqtt from 'mqtt';
import { z } from 'zod';
import { Store } from './store.js';
import { PREFIX } from './contracts.js';
import { buildApp } from './app.js';

const env = z
  .object({
    MQTT_URL: z.url().refine((v) => v.startsWith('mqtts://')),
    MQTT_USER: z.string().min(1),
    MQTT_PASSWORD: z.string().min(1),
    MQTT_CA_FILE: z.string().min(1),
    API_TOKEN: z.string().min(32),
    DB_PATH: z.string().default('./data/nightcare.sqlite'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('127.0.0.1'),
  })
  .parse(process.env);

mkdirSync(dirname(env.DB_PATH), { recursive: true });
const store = new Store(env.DB_PATH);
const client = mqtt.connect(env.MQTT_URL, {
  username: env.MQTT_USER,
  password: env.MQTT_PASSWORD,
  ca: readFileSync(env.MQTT_CA_FILE),
  rejectUnauthorized: true,
  clientId: 'nightcare-backend',
  clean: true,
  reconnectPeriod: 0,
  connectTimeout: 10000,
  queueQoSZero: false,
});

store.publish = async (topic, payload, retain) => {
  if (!client.connected) throw new Error('offline');
  await client.publishAsync(topic, payload, { qos: 1, retain });
};

const app = await buildApp(store, env.API_TOKEN, () => client.connected);
let delay = 1000;
let retry: NodeJS.Timeout | undefined;
let stopping = false;

client.on('connect', () => {
  delay = 1000;
  if (retry) clearTimeout(retry);
  retry = undefined;
  void (async () => {
    await client.subscribeAsync(
      ['events', 'state', 'availability', 'acks'].map((t) => PREFIX + t),
      { qos: 1 },
    );
    await store.replay();
  })().catch((e) => app.log.error(e));
});

client.on('close', () => {
  store.markDisconnected();

  if (stopping || retry) return;

  retry = setTimeout(() => {
    retry = undefined;
    client.reconnect();
  }, delay);

  delay = Math.min(delay * 2, 30000);
});

client.on('error', (e) => app.log.warn({ message: e.message }, 'MQTT connection error'));

client.on('message', (topic, raw, packet) => {
  try {
    store.ingest(topic, raw, packet.retain);
  } catch (e) {
    app.log.warn({ topic, message: (e as Error).message }, 'Rejected MQTT payload');
  }
});

const tick = setInterval(() => store.tick(), 1000);
tick.unref();
await app.listen({ port: env.PORT, host: env.HOST });
async function shutdown() {
  if (stopping) return;

  stopping = true;
  clearInterval(tick);

  if (retry) clearTimeout(retry);

  await client.endAsync(true);
  await app.close();
  store.close();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
