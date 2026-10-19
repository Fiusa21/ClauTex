import type { FastifyInstance } from "fastify";
import { mkdir } from "node:fs/promises";
import { buildApp } from "./app.ts";
import type { Config } from "./config.ts";

/** Creates the workspace if needed and listens on 127.0.0.1 only (SPEC §5). */
export async function startServer(config: Config): Promise<FastifyInstance> {
  await mkdir(config.workspace, { recursive: true });
  const app = await buildApp(config);
  await app.listen({ host: "127.0.0.1", port: config.port });
  return app;
}
