import Fastify from "fastify";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import type { WebSocket } from "ws";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { commandInput, settingsSchema } from "./contracts.js";
import { Store } from "./store.js";
export async function buildApp(
  store: Store,
  brokerConnected: () => boolean = () => false,
  options: { demo?: boolean; staticRoot?: string } = {},
) {
  const app = Fastify({ logger: true, bodyLimit: 8192 });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: error.issues });
    const e = error as Error & { statusCode?: number };
    if (e.statusCode)
      return reply.code(e.statusCode).send({ error: e.message });
    if (
      /^(ID_CONFLICT|DEVICE_OFFLINE|CLOCK_INVALID|REQUEST_MISMATCH|INVALID_TRANSITION)$/.test(
        e.message,
      )
    )
      return reply.code(409).send({ error: e.message });
    req.log.error(error);
    return reply.code(500).send({ error: "INTERNAL_ERROR" });
  });
  const wsOptions = { maxPayload: 8192, closeTimeout: 1000 };
  await app.register(websocket, { options: wsOptions });
  const sockets = new Set<WebSocket>();
  const snapshot = () => ({
    ...store.snapshot(),
    brokerConnected: brokerConnected(),
  });
  const encode = () => JSON.stringify({ type: "snapshot", data: snapshot() });
  let previous = encode();
  const broadcast = setInterval(() => {
    const current = encode();
    if (current !== previous) {
      previous = current;
      for (const socket of sockets) {
        if (socket.readyState === 1 && socket.bufferedAmount < 65536)
          socket.send(current);
      }
    }
  }, 250);
  broadcast.unref();
  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.close());
    socket.on("close", () => sockets.delete(socket));
    socket.send(encode());
  });
  app.get("/ui-config", async () => ({ demo: !!options.demo }));
  app.addHook("onClose", async () => {
    clearInterval(broadcast);
    for (const socket of sockets) socket.close(1001, "Shutdown");
    sockets.clear();
  });
  const publicDir =
    options.staticRoot ?? fileURLToPath(new URL("../public", import.meta.url));
  if (existsSync(publicDir)) {
    await app.register(staticFiles, { root: publicDir });
  }
  app.get("/dashboard", async (_, reply) => reply.redirect("/", 308));
  app.get("/dashboard/", async (_, reply) => reply.redirect("/", 308));
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_, reply) => {
    store.db.prepare("SELECT 1").get();
    return reply
      .code(brokerConnected() ? 200 : 503)
      .send({ sqlite: true, mqtt: brokerConnected() });
  });
  app.get("/api/status", async () => ({
    ...store.snapshot(),
    brokerConnected: brokerConnected(),
  }));
  const pageQuery = z.object({
    limit: z.coerce.number().int().min(1).max(500).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    page: z.literal("true").optional(),
  });
  app.get("/api/events", async (req) => {
    const query = pageQuery
      .extend({
        type: z.string().max(64).optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
      })
      .strict()
      .parse(req.query);
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to))
      throw Object.assign(new Error("INVALID_PERIOD"), { statusCode: 400 });
    return query.page || query.cursor
      ? store.page("events", query)
      : store.history(query);
  });
  for (const kind of ["requests", "commands", "configs"] as const) {
    app.get("/api/" + kind, async (req) =>
      store.page(kind, pageQuery.strict().parse(req.query)),
    );
  }
  app.post("/api/config", async (req, reply) =>
    reply.code(202).send(await store.setConfig(settingsSchema.parse(req.body))),
  );
  app.post("/api/commands", async (req, reply) =>
    reply.code(202).send(await store.command(commandInput.parse(req.body))),
  );
  app.get("/api/commands/:id", async (req, reply) => {
    const id = z.object({ id: z.string().max(120) }).parse(req.params).id;
    const c = store.getCommand(id);
    return c ?? reply.code(404).send({ error: "NOT_FOUND" });
  });
  return app;
}
