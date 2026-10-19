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
import { call, linkDir, testApp, upload } from "./helpers.ts";

let app: FastifyInstance;
let workspace: string;
let project: string;
const base = "/api/projects/Paper/files";

beforeEach(async () => {
  ({ app, workspace } = await testApp());
  await call(app, "POST", "/api/projects", { name: "Paper" });
  project = join(workspace, "Paper");
});

afterEach(async () => {
  await app.close();
});

const list = async () =>
  (await call(app, "GET", base)).json<{ path: string }[]>().map((f) => f.path);
const q = (path: string) => `?path=${encodeURIComponent(path)}`;

const BAD_PATHS = [
  "../escape.tex",
  "a/../../escape.tex",
  "/etc/passwd",
  "C:/Windows/x.tex",
  "a\\b.tex",
  "a//b.tex",
  "./x.tex",
  "CON.tex",
  "what?.tex",
  ".git/hooks/pre-commit",
  ".texcollab.json",
  "folder/.hidden",
];

describe("listing", () => {
  it("lists files and folders recursively, skipping hidden entries", async () => {
    mkdirSync(join(project, "chapters"));
    writeFileSync(join(project, "chapters", "one.tex"), "1");
    writeFileSync(join(project, "fig.png"), "png");
    mkdirSync(join(project, ".git"));
    writeFileSync(join(project, ".git", "config"), "x");
    writeFileSync(join(project, ".texcollab.json"), "{}");

    const files = (await call(app, "GET", base)).json<
      Record<string, unknown>[]
    >();

    expect(files.map((f) => f.path)).toEqual([
      "chapters",
      "chapters/one.tex",
      "fig.png",
      "main.tex",
    ]);
    expect(files.find((f) => f.path === "main.tex")).toMatchObject({
      kind: "file",
      text: true,
    });
    expect(files.find((f) => f.path === "fig.png")).toMatchObject({
      kind: "file",
      text: false,
      size: 3,
    });
    expect(files.find((f) => f.path === "chapters")).toMatchObject({
      kind: "folder",
    });
  });

  it("skips symlinks that lead outside the project", async () => {
    const outside = join(workspace, "..", "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "secret");
    linkDir(outside, join(project, "escape"));
    expect(await list()).toEqual(["main.tex"]);
  });
});

describe("creating", () => {
  it("creates files and folders, with missing parents", async () => {
    expect(
      (
        await call(app, "POST", base, {
          path: "chapters/part1/intro.tex",
          kind: "file",
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(app, "POST", base, { path: "figures", kind: "folder" }))
        .statusCode,
    ).toBe(201);
    expect(
      readFileSync(join(project, "chapters", "part1", "intro.tex"), "utf8"),
    ).toBe("");
    expect(await list()).toEqual([
      "chapters",
      "chapters/part1",
      "chapters/part1/intro.tex",
      "figures",
      "main.tex",
    ]);
  });

  it("refuses existing paths and files used as folders", async () => {
    expect(
      (
        await call(app, "POST", base, { path: "main.tex", kind: "file" })
      ).json(),
    ).toMatchObject({
      code: "path_exists",
    });
    expect(
      (
        await call(app, "POST", base, { path: "main.tex/x.tex", kind: "file" })
      ).json(),
    ).toMatchObject({
      code: "path_conflict",
    });
    expect(
      (await call(app, "POST", base, { path: "x", kind: "link" })).statusCode,
    ).toBe(400);
  });
});

describe("path safety on every endpoint", () => {
  it.each(BAD_PATHS)("rejects %s", async (path) => {
    writeFileSync(join(workspace, "escape.tex"), "outside");
    const responses = [
      await call(app, "POST", base, { path, kind: "file" }),
      await upload(app, `${base}/upload${q(path)}`, "x.tex", "x"),
      await call(app, "PATCH", base, { from: "main.tex", to: path }),
      await call(app, "PATCH", base, { from: path, to: "moved.tex" }),
      await call(app, "DELETE", `${base}${q(path)}`),
      await call(app, "GET", `${base}/content${q(path)}`),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: "invalid_path" });
    }
    expect(readdirSync(project).sort()).toEqual(["main.tex"]);
    expect(readFileSync(join(workspace, "escape.tex"), "utf8")).toBe("outside");
  });

  it("refuses to read or write through a symlink that leads outside", async () => {
    const outside = join(workspace, "..", "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "secret");
    linkDir(outside, join(project, "escape"));

    for (const res of [
      await call(app, "GET", `${base}/content${q("escape/secret.txt")}`),
      await call(app, "POST", base, { path: "escape/new.tex", kind: "file" }),
      await upload(app, `${base}/upload${q("escape/up.tex")}`, "up.tex", "x"),
      await call(app, "PATCH", base, {
        from: "main.tex",
        to: "escape/main.tex",
      }),
      await call(app, "DELETE", `${base}${q("escape/secret.txt")}`),
    ]) {
      expect(res.statusCode).toBe(400);
    }
    expect(readdirSync(outside)).toEqual(["secret.txt"]);
    expect(existsSync(join(project, "main.tex"))).toBe(true);
  });
});

describe("uploads", () => {
  it("stores text and binary files; client file names are reduced to their base name", async () => {
    const text = await upload(
      app,
      `${base}/upload${q("refs/library.bib")}`,
      "library.bib",
      "@book{a}",
    );
    const binary = await upload(
      app,
      `${base}/upload`,
      "C:\\Users\\me\\..\\fig.png",
      Buffer.from([0x89, 0x50]),
    );

    expect(text.statusCode).toBe(201);
    expect(text.json()).toMatchObject({ path: "refs/library.bib", text: true });
    expect(binary.json()).toMatchObject({
      path: "fig.png",
      text: false,
      size: 2,
    });
    expect(readFileSync(join(project, "refs", "library.bib"), "utf8")).toBe(
      "@book{a}",
    );
    expect(
      readdirSync(project).filter((n) => n.startsWith(".texcollab-upload")),
    ).toEqual([]);
  });

  it("replaces an existing file only when asked", async () => {
    await upload(app, `${base}/upload`, "fig.png", "old");
    expect(
      (await upload(app, `${base}/upload`, "fig.png", "new")).json(),
    ).toMatchObject({ code: "path_exists" });
    expect(
      (await upload(app, `${base}/upload?replace=true`, "fig.png", "new"))
        .statusCode,
    ).toBe(201);
    expect(readFileSync(join(project, "fig.png"), "utf8")).toBe("new");
  });

  it("rejects files over 50 MB without leaving anything behind", async () => {
    const res = await upload(
      app,
      `${base}/upload`,
      "big.pdf",
      Buffer.alloc(50 * 1024 * 1024 + 1),
    );
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: "file_too_large" });
    expect(readdirSync(project)).toEqual(["main.tex"]);
  });
});

describe("content", () => {
  it("serves text inline with an ETag and safety headers", async () => {
    const res = await call(app, "GET", `${base}/content${q("main.tex")}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("\\documentclass{article}");
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.headers.etag).toMatch(/^"\d+-\d+"$/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toMatch(/^sandbox/);
    expect(res.headers["content-disposition"]).toMatch(/^inline/);
  });

  it("serves images inline and unknown types as attachments, typed by extension", async () => {
    writeFileSync(join(project, "plot.svg"), "<svg/>");
    writeFileSync(join(project, "page.html"), "<script>alert(1)</script>");
    writeFileSync(join(project, "Grüße.png"), "png");

    const svg = await call(app, "GET", `${base}/content${q("plot.svg")}`);
    const html = await call(app, "GET", `${base}/content${q("page.html")}`);
    const unicode = await call(
      app,
      "GET",
      `${base}/content${q("Grüße.png")}&download=true`,
    );

    expect(svg.headers["content-type"]).toBe("image/svg+xml");
    expect(svg.headers["content-security-policy"]).toMatch(/^sandbox/);
    expect(html.headers["content-type"]).toBe("application/octet-stream");
    expect(html.headers["content-disposition"]).toMatch(/^attachment/);
    expect(unicode.headers["content-disposition"]).toBe(
      `attachment; filename="Gr__e.png"; filename*=UTF-8''${encodeURIComponent("Grüße.png")}`,
    );
  });

  it("404s for folders and missing files", async () => {
    mkdirSync(join(project, "dir"));
    expect(
      (await call(app, "GET", `${base}/content${q("dir")}`)).statusCode,
    ).toBe(404);
    expect(
      (await call(app, "GET", `${base}/content${q("nope.tex")}`)).statusCode,
    ).toBe(404);
    expect(
      (await call(app, "GET", `/api/projects/Nope/files`)).statusCode,
    ).toBe(404);
  });
});

describe("moving", () => {
  it("renames and moves files; folders move with their contents", async () => {
    await call(app, "POST", base, { path: "src/a/one.tex", kind: "file" });
    expect(
      (
        await call(app, "PATCH", base, {
          from: "src/a/one.tex",
          to: "src/a/1.tex",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(app, "PATCH", base, { from: "src", to: "chapters/src" }))
        .statusCode,
    ).toBe(200);
    expect(await list()).toEqual([
      "chapters",
      "chapters/src",
      "chapters/src/a",
      "chapters/src/a/1.tex",
      "main.tex",
    ]);
  });

  it("keeps the main file pointing at the moved file", async () => {
    await call(app, "PATCH", base, { from: "main.tex", to: "tex/thesis.tex" });
    expect(
      (await call(app, "GET", "/api/projects/Paper")).json(),
    ).toMatchObject({ mainFile: "tex/thesis.tex" });
    await call(app, "PATCH", base, { from: "tex", to: "source" });
    expect(
      (await call(app, "GET", "/api/projects/Paper")).json(),
    ).toMatchObject({ mainFile: "source/thesis.tex" });
  });

  it("refuses invalid moves", async () => {
    await call(app, "POST", base, { path: "a/b/c.tex", kind: "file" });
    expect(
      (await call(app, "PATCH", base, { from: "a", to: "a/b/a" })).json(),
    ).toMatchObject({ code: "invalid_move" });
    expect(
      (
        await call(app, "PATCH", base, { from: "a/b/c.tex", to: "main.tex" })
      ).json(),
    ).toMatchObject({
      code: "path_exists",
    });
    expect(
      (await call(app, "PATCH", base, { from: "nope.tex", to: "x.tex" }))
        .statusCode,
    ).toBe(404);
  });

  it("allows case-only renames", async () => {
    await call(app, "POST", base, { path: "intro.tex", kind: "file" });
    expect(
      (await call(app, "PATCH", base, { from: "intro.tex", to: "Intro.tex" }))
        .statusCode,
    ).toBe(200);
    expect(await list()).toEqual(["Intro.tex", "main.tex"]);
  });
});

describe("deleting", () => {
  it("moves deleted files and folders into the workspace trash", async () => {
    await call(app, "POST", base, { path: "figs/a.png", kind: "file" });
    expect((await call(app, "DELETE", `${base}${q("figs")}`)).statusCode).toBe(
      204,
    );
    expect(await list()).toEqual(["main.tex"]);
    const [stamp] = readdirSync(join(workspace, ".trash", "Paper"));
    expect(
      existsSync(
        join(workspace, ".trash", "Paper", stamp ?? "", "figs", "a.png"),
      ),
    ).toBe(true);
  });

  it("protects the main file and folders containing it", async () => {
    await call(app, "PATCH", base, { from: "main.tex", to: "src/main.tex" });
    expect(
      (await call(app, "DELETE", `${base}${q("src/main.tex")}`)).json(),
    ).toMatchObject({
      code: "main_file_protected",
    });
    expect((await call(app, "DELETE", `${base}${q("src")}`)).statusCode).toBe(
      409,
    );
    expect(await list()).toEqual(["src", "src/main.tex"]);
  });
});
