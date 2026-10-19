import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import type { Config } from "./config.ts";
import { createGuard } from "./guard.ts";
import { ApiError, sendProblem } from "./problem.ts";
import { VERSION } from "./version.ts";

export async function buildApp(
  config: Config,
  opts: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 4 * 1024 * 1024,
  });

  app.addHook("onRequest", createGuard(config.port, config.devOrigins));

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      return sendProblem(reply, error.status, error.code, error.message);
    }
    // Fastify's own client errors (malformed JSON, body too large, …) carry a 4xx statusCode.
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (
      typeof statusCode === "number" &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      const detail = error instanceof Error ? error.message : "Bad request.";
      return sendProblem(reply, statusCode, "bad_request", detail);
    }
    request.log.error(error);
    console.error(error);
    return sendProblem(
      reply,
      500,
      "internal_error",
      "An unexpected error occurred.",
    );
  });

  app.get("/api/health", () => ({
    status: "UP",
    version: VERSION,
    workspace: config.workspace,
  }));

  const hasWeb = existsSync(join(config.webDist, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      wildcard: false,
      // Hashed assets never change; index.html must always be revalidated.
      setHeaders: (reply, path) => {
        void reply.header(
          "cache-control",
          path.includes(`${sep}assets${sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (path.startsWith("/api/") || request.method !== "GET") {
      return sendProblem(reply, 404, "not_found", "Not found.");
    }
    if (!hasWeb) {
      return reply
        .code(503)
        .type("text/plain; charset=utf-8")
        .send(
          "The web app is not built. Run `npm start` from the repository root.",
        );
    }
    // SPA fallback: client-side routes are rendered by index.html.
    return reply.header("cache-control", "no-cache").sendFile("index.html");
  });

  return app;
}
