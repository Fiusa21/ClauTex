import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import type { LocalCompiler } from "../compile/compiler.ts";
import { ApiError } from "../problem.ts";
import { contentDisposition } from "./files.ts";

type NameParams = {
  Params: { name: string };
  Querystring: Record<string, string | undefined>;
};

export function compileRoutes(
  app: FastifyInstance,
  compiler: LocalCompiler,
): void {
  app.post<NameParams>("/api/projects/:name/compile", (request) =>
    compiler.compile(request.params.name),
  );

  app.get<NameParams>("/api/projects/:name/build", async (request) => ({
    build: await compiler.lastBuild(request.params.name),
  }));

  app.get<NameParams>(
    "/api/projects/:name/output.pdf",
    async (request, reply) => {
      const file = await compiler.output(request.params.name, "pdf");
      if (!file)
        throw new ApiError(
          404,
          "no_pdf",
          "There is no PDF yet. Compile the project first.",
        );
      const download = request.query.download === "true";
      return reply
        .header("content-type", "application/pdf")
        .header("cache-control", "no-cache")
        .header("x-content-type-options", "nosniff")
        .header(
          "content-disposition",
          contentDisposition(
            download ? "attachment" : "inline",
            `${request.params.name}.pdf`,
          ),
        )
        .send(createReadStream(file));
    },
  );

  app.get<NameParams>(
    "/api/projects/:name/output.log",
    async (request, reply) => {
      const file = await compiler.output(request.params.name, "log");
      if (!file)
        throw new ApiError(
          404,
          "no_log",
          "There is no log yet. Compile the project first.",
        );
      return reply
        .header("content-type", "text/plain; charset=utf-8")
        .header("cache-control", "no-cache")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "sandbox; default-src 'none'")
        .send(createReadStream(file));
    },
  );
}
