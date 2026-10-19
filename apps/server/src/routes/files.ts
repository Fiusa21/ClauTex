import type { FastifyInstance, FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import { ProjectFiles } from "../files.ts";
import { ApiError } from "../problem.ts";
import { contentType, isImage } from "../textFiles.ts";
import type { Workspace } from "../workspace.ts";

type NameParams = {
  Params: { name: string };
  Querystring: Record<string, string | undefined>;
};

/**
 * Served user content must never run script in our origin (e.g. an SVG or HTML file opened directly): it is
 * sandboxed, typed by extension only, and sent as an attachment unless it is an image or plain text.
 */
const CONTENT_CSP =
  "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

export function contentDisposition(
  kind: "inline" | "attachment",
  fileName: string,
): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function fileRoutes(app: FastifyInstance, workspace: Workspace): void {
  const filesOf = async (name: string) =>
    new ProjectFiles(workspace, await workspace.projectDir(name));
  const body = (raw: unknown) =>
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  app.get<NameParams>("/api/projects/:name/files", async (request) =>
    (await filesOf(request.params.name)).list(),
  );

  app.post<NameParams>("/api/projects/:name/files", async (request, reply) => {
    const { path, kind } = body(request.body);
    const created = await (
      await filesOf(request.params.name)
    ).create(path, kind);
    return reply.code(201).send(created);
  });

  app.patch<NameParams>("/api/projects/:name/files", async (request) => {
    const { from, to } = body(request.body);
    return (await filesOf(request.params.name)).move(from, to);
  });

  app.delete<NameParams>(
    "/api/projects/:name/files",
    async (request, reply) => {
      const files = await filesOf(request.params.name);
      await files.remove(request.query.path, request.params.name);
      return reply.code(204).send();
    },
  );

  app.post<NameParams>(
    "/api/projects/:name/files/upload",
    async (request, reply) => {
      const files = await filesOf(request.params.name);
      const part = await request.file();
      if (!part)
        throw new ApiError(
          400,
          "validation_failed",
          'Send the file in a multipart field named "file".',
        );
      const fallbackName =
        part.filename.replace(/\\/g, "/").split("/").pop() ?? "";
      const target = request.query.path ?? fallbackName;
      const stored = await files.upload(
        target,
        part.file,
        request.query.replace === "true",
      );
      return reply.code(201).send(stored);
    },
  );

  app.get<NameParams>("/api/projects/:name/files/text", async (request) =>
    (await filesOf(request.params.name)).readText(request.query.path),
  );

  app.put<NameParams>("/api/projects/:name/files/text", async (request) => {
    const { text, baseEtag } = body(request.body);
    return (await filesOf(request.params.name)).writeText(
      request.query.path,
      text,
      baseEtag,
    );
  });

  app.post<NameParams>("/api/projects/:name/files/convert", async (request) =>
    (await filesOf(request.params.name)).convertToUtf8(request.query.path),
  );

  app.get<NameParams>(
    "/api/projects/:name/files/content",
    async (request, reply: FastifyReply) => {
      const files = await filesOf(request.params.name);
      const file = await files.existingFile(request.query.path);
      const name = file.path.slice(file.path.lastIndexOf("/") + 1);
      const type = contentType(file.path);
      const inline =
        request.query.download !== "true" &&
        (isImage(file.path) || type.startsWith("text/"));
      return reply
        .header("content-type", type)
        .header("content-length", file.size)
        .header(
          "etag",
          `"${String(file.mtime.getTime())}-${String(file.size)}"`,
        )
        .header("cache-control", "no-cache")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", CONTENT_CSP)
        .header(
          "content-disposition",
          contentDisposition(inline ? "inline" : "attachment", name),
        )
        .send(createReadStream(file.abs));
    },
  );
}
