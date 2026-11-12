import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import mqtt from "mqtt";
import { z } from "zod";
import { Store } from "./store.js";
import { PREFIX } from "./contracts.js";
import { buildApp } from "./app.js";
const demo = process.env.DEMO_MODE === "true";
const env = z
  .object({
    MQTT_URL: z
      .url()
      .refine(
        (v) => v.startsWith("mqtts://") || (demo && v.startsWith("mqtt://")),
      ),
    MQTT_USER: z.string().optional(),
    MQTT_PASSWORD: z.string().optional(),
    MQTT_CA_FILE: z.string().optional(),
    MQTT_PREFIX: z
      .string()
      .regex(/^[A-Za-z0-9_/-]+\/$/)
      .max(80)
      .default(PREFIX),
    MQTT_CLIENT_ID: z.string().min(1).max(100).default("nightcare-backend"),
    DB_PATH: z.string().default("./data/nightcare.sqlite"),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default("127.0.0.1"),
  })
  .parse(process.env);
if (!demo && (!env.MQTT_USER || !env.MQTT_PASSWORD || !env.MQTT_CA_FILE))
  throw new Error(
    "TLS mode requires MQTT_USER, MQTT_PASSWORD and MQTT_CA_FILE",
  );
mkdirSync(dirname(env.DB_PATH), { recursive: true });
const store = new Store(env.DB_PATH, undefined, env.MQTT_PREFIX);
const client = mqtt.connect(env.MQTT_URL, {
  username: env.MQTT_USER,
  password: env.MQTT_PASSWORD,
  ca: env.MQTT_CA_FILE ? readFileSync(env.MQTT_CA_FILE) : undefined,
  rejectUnauthorized: true,
  clientId: env.MQTT_CLIENT_ID,
  clean: true,
  reconnectPeriod: 0,
  connectTimeout: 10000,
  queueQoSZero: false,
});
store.publish = async (topic, payload, retain) => {
  if (!client.connected) throw new Error("offline");
  await client.publishAsync(topic, payload, { qos: 1, retain });
};
const app = await buildApp(store, () => client.connected, {
  demo,
  staticRoot: process.env.STATIC_ROOT,
});
let delay = 1000;
let retry: NodeJS.Timeout | undefined;
let stopping = false;
client.on("connect", () => {
  delay = 1000;
  if (retry) clearTimeout(retry);
  retry = undefined;
  void (async () => {
    await client.subscribeAsync(
      ["events", "state", "availability", "acks"].map(
        (t) => store.rootPrefix + "+/" + t,
      ),
      { qos: 1 },
    );
    await store.replay();
  })().catch((e) => app.log.error(e));
});
client.on("close", () => {
  store.markDisconnected();
  if (stopping || retry) return;
  retry = setTimeout(() => {
    retry = undefined;
    client.reconnect();
  }, delay);
  delay = Math.min(delay * 2, 30000);
});
client.on("error", (e) =>
  app.log.warn({ message: e.message }, "MQTT connection error"),
);
client.on("message", (topic, raw, packet) => {
  try {
    store.ingest(topic, raw, packet.retain);
  } catch (e) {
    app.log.warn(
      { topic, message: (e as Error).message },
      "Rejected MQTT payload",
    );
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
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
