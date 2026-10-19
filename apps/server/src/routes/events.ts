import type { FastifyInstance } from "fastify";
import { ProjectWatcher } from "../watcher.ts";
import type { Workspace } from "../workspace.ts";

/**
 * `GET /api/projects/:name/events` — server-sent events for changes on disk (SPEC §4):
 * `event: change` with `{"paths": [...]}`; `event: unavailable` if the folder cannot be watched.
 */
export function eventRoutes(app: FastifyInstance, workspace: Workspace): void {
  const watcher = new ProjectWatcher();
  app.addHook("onClose", () => {
    watcher.closeAll();
  });

  app.get<{ Params: { name: string } }>(
    "/api/projects/:name/events",
    async (request, reply) => {
      const dir = await workspace.projectDir(request.params.name);
      const res = reply.raw;
      reply.hijack();
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-content-type-options": "nosniff",
      });
      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send("ready", {});

      const unsubscribe = watcher.subscribe(
        dir,
        (paths) => {
          send("change", { paths });
        },
        (err) => {
          request.log.warn(err);
          send("unavailable", {
            reason: "This folder cannot be watched; reload to see changes.",
          });
        },
      );
      // Comments keep proxies and browsers from closing an idle stream.
      const keepAlive = setInterval(
        () => res.write(": keep-alive\n\n"),
        25_000,
      );
      request.raw.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    },
  );
}
