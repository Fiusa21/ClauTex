import type { FastifyInstance } from "fastify";
import { apiPath } from "../files.ts";
import { ApiError } from "../problem.ts";
import { ProjectFiles } from "../files.ts";
import type { Compiler, Workspace } from "../workspace.ts";
import { exportZip, importZip, MAX_IMPORT_BYTES } from "../zip.ts";
import { contentDisposition } from "./files.ts";

const COMPILERS = new Set(["pdflatex", "xelatex", "lualatex"]);

type NameParams = { Params: { name: string } };

function body(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};
}

export function projectRoutes(
  app: FastifyInstance,
  workspace: Workspace,
): void {
  app.get("/api/projects", () => workspace.list());

  app.post("/api/projects", async (request, reply) => {
    const project = await workspace.create(body(request.body).name as string);
    return reply.code(201).send(project);
  });

  app.get<NameParams>("/api/projects/:name", (request) =>
    workspace.info(request.params.name),
  );

  app.patch<NameParams>("/api/projects/:name", async (request) => {
    const { name, mainFile, compiler } = body(request.body);
    if (
      name === undefined &&
      mainFile === undefined &&
      compiler === undefined
    ) {
      throw new ApiError(
        400,
        "validation_failed",
        "Provide at least one of name, mainFile, compiler.",
      );
    }
    let current = request.params.name;
    const dir = await workspace.projectDir(current);
    const changes: { mainFile?: string; compiler?: Compiler } = {};
    if (mainFile !== undefined) {
      const files = new ProjectFiles(workspace, dir);
      const main = await files.existingFile(apiPath(mainFile));
      if (!main.path.toLowerCase().endsWith(".tex")) {
        throw new ApiError(
          400,
          "validation_failed",
          "The main file must be a .tex file.",
        );
      }
      changes.mainFile = main.path;
    }
    if (compiler !== undefined) {
      if (typeof compiler !== "string" || !COMPILERS.has(compiler)) {
        throw new ApiError(
          400,
          "validation_failed",
          "compiler must be pdflatex, xelatex or lualatex.",
        );
      }
      changes.compiler = compiler as Compiler;
    }
    if (changes.mainFile !== undefined || changes.compiler !== undefined) {
      await workspace.saveSettings(dir, changes);
    }
    if (name !== undefined)
      current = await workspace.rename(current, name as string);
    return workspace.info(current);
  });

  app.delete<NameParams>("/api/projects/:name", async (request, reply) => {
    await workspace.trash(request.params.name);
    return reply.code(204).send();
  });

  app.post<NameParams>(
    "/api/projects/:name/duplicate",
    async (request, reply) => {
      const name = body(request.body).name;
      const copy = await workspace.duplicate(
        request.params.name,
        name === undefined ? undefined : (name as string),
      );
      return reply.code(201).send(copy);
    },
  );

  app.post("/api/projects/import", async (request, reply) => {
    const part = await request.file({ limits: { fileSize: MAX_IMPORT_BYTES } });
    if (!part)
      throw new ApiError(
        400,
        "validation_failed",
        'Send the ZIP in a multipart field named "file".',
      );
    const bytes = await part.toBuffer().catch(() => {
      throw new ApiError(
        413,
        "archive_too_large",
        "ZIP files can be at most 200 MB.",
      );
    });
    const nameField = part.fields.name;
    const requested =
      nameField &&
      !Array.isArray(nameField) &&
      nameField.type === "field" &&
      typeof nameField.value === "string" &&
      nameField.value.trim()
        ? nameField.value.trim()
        : undefined;
    const project = await importZip(workspace, bytes, requested, part.filename);
    return reply.code(201).send(project);
  });

  app.get<NameParams>(
    "/api/projects/:name/export.zip",
    async (request, reply) => {
      const dir = await workspace.projectDir(request.params.name);
      const { name } = await workspace.info(request.params.name);
      return reply
        .header("content-type", "application/zip")
        .header(
          "content-disposition",
          contentDisposition("attachment", `${name}.zip`),
        )
        .header("cache-control", "no-store")
        .send(exportZip(dir));
    },
  );

  app.get("/api/trash", () => workspace.listTrash());

  app.post<{ Params: { entry: string } }>(
    "/api/trash/:entry/restore",
    (request) => workspace.restore(request.params.entry),
  );
}
