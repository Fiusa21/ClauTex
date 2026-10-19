import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, testApp } from "./helpers.ts";

let app: FastifyInstance;
let root: string;
let project: string;

beforeEach(async () => {
  let workspace: string;
  ({ app, root, workspace } = await testApp());
  await call(app, "POST", "/api/projects", { name: "Paper" });
  project = join(workspace, "Paper");
});

afterEach(async () => {
  await app.close();
});

interface Build {
  status: string;
  errors: {
    level: string;
    file: string | null;
    line: number | null;
    message: string;
  }[];
  logExcerpt: string;
  pdfUrl: string | null;
  pdfIsFresh: boolean;
}

const compile = async () => {
  const res = await call(app, "POST", "/api/projects/Paper/compile");
  return { status: res.statusCode, build: res.json<Build>() };
};

const setMain = (text: string, path = "main.tex") => {
  writeFileSync(join(project, ...path.split("/")), text);
};

describe("compile", () => {
  it("runs latexmk with safe arguments and serves the PDF", async () => {
    const { status, build } = await compile();

    expect(status).toBe(200);
    expect(build).toMatchObject({
      status: "success",
      pdfIsFresh: true,
      errors: [],
    });
    const args = JSON.parse(
      /args: (.*)/.exec(build.logExcerpt)?.[1] ?? "[]",
    ) as string[];
    expect(args.slice(0, 7)).toEqual([
      "-pdf",
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-no-shell-escape",
      "-norc",
      expect.stringMatching(/^-outdir=/),
    ]);
    expect(args.slice(7)).toEqual(["-jobname=output", "./main.tex"]);
    expect(build.logExcerpt).toContain(
      "env: max_print_line=10000 openout_any=p",
    );

    // Output lives in the cache folder, not in the project.
    expect(args[6]).toContain(join(root, "cache"));
    expect(readdirSync(project)).toEqual(["main.tex"]);

    const pdf = await call(app, "GET", build.pdfUrl ?? "");
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.body).toContain("%PDF-1.4");
    const log = await call(app, "GET", "/api/projects/Paper/output.log");
    expect(log.body).toContain("This is FakeTeX");
  });

  it("uses the project's engine and compiles in the main file's folder", async () => {
    mkdirSync(join(project, "src", "chapters"), { recursive: true });
    setMain("hello", "src/thesis.tex");
    await call(app, "PATCH", "/api/projects/Paper", {
      mainFile: "src/thesis.tex",
      compiler: "lualatex",
    });

    const { build } = await compile();

    expect(build.logExcerpt).toContain('"-lualatex"');
    expect(build.logExcerpt).toContain('"./thesis.tex"');
    expect(build.logExcerpt).toMatch(/cwd: .*[/\\]Paper[/\\]src\n/);
    // Folders are mirrored into the output folder so \include can write its .aux files.
    const outdir = (
      /-outdir=([^"]+)/.exec(build.logExcerpt)?.[1] ?? ""
    ).replace(/\\\\/g, "\\");
    expect(existsSync(join(outdir, "src", "chapters"))).toBe(true);
  });

  it("reports errors with project file and line, and keeps the last good PDF", async () => {
    const first = (await compile()).build;
    setMain("BREAK");

    const { build } = await compile();

    expect(build.status).toBe("failure");
    expect(build.errors).toEqual([
      {
        level: "error",
        file: "main.tex",
        line: 3,
        message: "Undefined control sequence.",
      },
    ]);
    expect(build.pdfIsFresh).toBe(false);
    expect(build.pdfUrl).not.toBeNull();
    expect(build.pdfUrl).not.toBe(first.pdfUrl);
    expect((await call(app, "GET", build.pdfUrl ?? "")).body).toContain(
      "%PDF-1.4",
    );
  });

  it("counts a run without PDF as a failure", async () => {
    setMain("NOPDF");
    expect((await compile()).build).toMatchObject({
      status: "failure",
      pdfUrl: null,
    });
    expect(
      (await call(app, "GET", "/api/projects/Paper/output.pdf")).json(),
    ).toMatchObject({ code: "no_pdf" });
  });

  it("remembers the last build for when the project is reopened", async () => {
    expect(
      (await call(app, "GET", "/api/projects/Paper/build")).json(),
    ).toEqual({ build: null });
    const { build } = await compile();
    expect(
      (await call(app, "GET", "/api/projects/Paper/build")).json(),
    ).toEqual({ build });
  });

  it("kills the whole process tree at the timeout, and allows one compile per project at a time", async () => {
    await call(app, "PATCH", "/api/settings", { compileTimeoutSeconds: 10 });
    setMain("SLEEP");

    const running = compile();
    await new Promise((r) => setTimeout(r, 1500));
    const second = await compile();
    expect(second.status).toBe(409);
    expect(second.build).toMatchObject({ code: "compile_in_progress" });

    const { build } = await running;
    expect(build.status).toBe("timeout");
    expect(build.logExcerpt).toContain("stopped after 10 seconds");

    const outdir = join(root, "cache", "builds");
    const [key] = readdirSync(outdir);
    const pid = Number(
      readFileSync(join(outdir, key ?? "", "sleeper.pid"), "utf8"),
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(() => process.kill(pid, 0)).toThrow(); // the grandchild is gone too
  }, 30_000);

  it("needs a main file", async () => {
    const { rmSync } = await import("node:fs");
    rmSync(join(project, "main.tex"));
    expect((await compile()).build).toMatchObject({
      code: "main_file_not_found",
    });
  });

  it("explains a missing TeX installation", async () => {
    await app.close();
    ({ app } = await testApp({ latexmk: [join(root, "no-such-latexmk")] }));
    await call(app, "POST", "/api/projects", { name: "Paper" });

    const health = (await call(app, "GET", "/api/health")).json<{
      tex: { available: boolean; problem: string };
    }>();
    expect(health.tex.available).toBe(false);
    expect(health.tex.problem).toContain("did not run");
    const res = await call(app, "POST", "/api/projects/Paper/compile");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "tex_not_found" });
  });

  it("404s for unknown projects", async () => {
    expect(
      (await call(app, "POST", "/api/projects/Nope/compile")).statusCode,
    ).toBe(404);
    expect(
      (await call(app, "GET", "/api/projects/Nope/output.pdf")).statusCode,
    ).toBe(404);
  });
});
