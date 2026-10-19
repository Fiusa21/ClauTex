import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import type { Config } from "./config.ts";
import { createGuard } from "./guard.ts";
import { ApiError, sendProblem } from "./problem.ts";
import { LocalCompiler } from "./compile/compiler.ts";
import { DockerTex } from "./compile/docker.ts";
import { compileRoutes } from "./routes/compile.ts";
import { fileRoutes } from "./routes/files.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { SettingsStore } from "./settings.ts";
import { detectTex, findExecutable, type TexInfo } from "./tex.ts";
import { eventRoutes } from "./routes/events.ts";
import { projectRoutes } from "./routes/projects.ts";
import { MAX_UPLOAD_BYTES } from "./textFiles.ts";
import { VERSION } from "./version.ts";
import { Workspace } from "./workspace.ts";

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
      return sendProblem(
        reply,
        error.status,
        error.code,
        error.message,
        error.extra,
      );
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

  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
  });

  const settings = new SettingsStore(config.configDir);
  const stored = await settings.get();
  // The command line wins over the settings page; the default comes last.
  const workspace = new Workspace(
    config.workspaceLocked
      ? config.workspace
      : (stored.workspace ?? config.workspace),
    { folders: async () => (await settings.get()).recentFolders },
  );
  await workspace.setRoot(workspace.root);

  projectRoutes(app, workspace);
  fileRoutes(app, workspace);
  eventRoutes(app, workspace);

  // TeX detection runs once at startup (and on request); compiling uses the command it found.
  let tex: TexInfo = await detectTex(config.latexmk);
  const latexmkCommand = (): string[] | null => {
    if (!tex.available) return null;
    if (config.latexmk) return config.latexmk;
    const found = findExecutable("latexmk");
    return found ? [found] : null;
  };
  const dockerPath = findExecutable("docker");
  const docker = new DockerTex(
    config.docker ?? (dockerPath ? [dockerPath] : null),
    config.dockerImage,
  );
  const compiler = new LocalCompiler({
    workspace,
    settings,
    cacheDir: config.cacheDir,
    latexmk: latexmkCommand,
    docker,
  });
  app.get("/api/docker", () => docker.info());
  app.post("/api/docker/pull", () => {
    docker.pull();
    return docker.info();
  });
  compileRoutes(app, compiler);
  app.addHook("onClose", () => {
    compiler.stopAll();
  });

  app.get("/api/health", () => ({
    status: "UP",
    version: VERSION,
    workspace: workspace.root,
    tex,
  }));

  app.post("/api/tex/detect", async () => {
    tex = await detectTex(config.latexmk);
    return tex;
  });

  settingsRoutes(app, {
    settings,
    workspace,
    workspaceLocked: config.workspaceLocked,
    defaultWorkspace: config.workspace,
  });

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
