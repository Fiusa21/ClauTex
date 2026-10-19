import type { FastifyInstance } from "fastify";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { checkOpenableFolder } from "../folders.ts";
import { ApiError } from "../problem.ts";
import type { SettingsStore } from "../settings.ts";
import { externalId, type Workspace } from "../workspace.ts";

interface Deps {
  settings: SettingsStore;
  workspace: Workspace;
  /** Set by `--workspace`/`TEXCOLLAB_WORKSPACE`: the UI cannot change it. */
  workspaceLocked: boolean;
  defaultWorkspace: string;
}

export function settingsRoutes(app: FastifyInstance, deps: Deps): void {
  const { settings, workspace } = deps;

  const view = async () => {
    const s = await settings.get();
    return {
      compileTimeoutSeconds: s.compileTimeoutSeconds,
      compileMode: s.compileMode,
      workspace: workspace.root,
      workspaceLocked: deps.workspaceLocked,
    };
  };

  app.get("/api/settings", view);

  app.patch("/api/settings", async (request) => {
    const body =
      request.body !== null && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const { workspace: requested, ...rest } = body;
    if (requested !== undefined) {
      if (deps.workspaceLocked) {
        throw new ApiError(
          409,
          "workspace_locked",
          "The workspace was set when TexCollab was started and cannot be changed here.",
        );
      }
      // null resets to the default folder.
      if (
        requested !== null &&
        (typeof requested !== "string" || !isAbsolute(requested.trim()))
      ) {
        throw new ApiError(
          400,
          "validation_failed",
          "The workspace must be a full (absolute) folder path.",
        );
      }
      const target =
        requested === null ? deps.defaultWorkspace : resolve(requested.trim());
      await workspace.setRoot(target);
      await settings.setWorkspace(
        requested === null ? null : await realpath(target),
      );
    }
    await settings.update(rest);
    return view();
  });

  /** Folders opened from outside the workspace, with whether they still exist. */
  app.get("/api/folders", async () => {
    const { recentFolders } = await settings.get();
    return Promise.all(
      recentFolders.map(async (path) => {
        const real = await realpath(path).catch(() => null);
        return {
          path,
          id: real ? externalId(real) : null,
          exists: real !== null,
        };
      }),
    );
  });

  app.post("/api/folders", async (request, reply) => {
    const raw =
      request.body !== null && typeof request.body === "object"
        ? (request.body as Record<string, unknown>).path
        : undefined;
    const path = await checkOpenableFolder(raw, workspace.root);
    await settings.addRecentFolder(path);
    return reply.code(201).send(await workspace.info(externalId(path)));
  });

  /** Removes a folder from the list; nothing on disk changes. */
  app.delete<{ Querystring: { path?: string } }>(
    "/api/folders",
    async (request, reply) => {
      const path = request.query.path;
      if (!path)
        throw new ApiError(400, "validation_failed", "path is required.");
      await settings.removeRecentFolder(path);
      return reply.code(204).send();
    },
  );
}
