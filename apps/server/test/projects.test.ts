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
let workspace: string;

beforeEach(async () => {
  ({ app, workspace } = await testApp());
});

afterEach(async () => {
  await app.close();
});

const create = (name: string) => call(app, "POST", "/api/projects", { name });
const url = (name: string) => `/api/projects/${encodeURIComponent(name)}`;

describe("projects", () => {
  it("creates a folder with a starter main.tex", async () => {
    const res = await create("Thesis 50% & {more}");

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: "Thesis 50% & {more}",
      mainFile: "main.tex",
      compiler: "pdflatex",
    });
    const main = readFileSync(
      join(workspace, "Thesis 50% & {more}", "main.tex"),
      "utf8",
    );
    expect(main).toContain("\\title{Thesis 50\\% \\& \\{more\\}}");
  });

  it("lists non-hidden folders, newest first", async () => {
    await create("Old");
    await new Promise((r) => setTimeout(r, 20));
    await create("New");
    mkdirSync(join(workspace, ".git"));
    writeFileSync(join(workspace, "notes.txt"), "not a project");

    const res = await call(app, "GET", "/api/projects");
    expect(res.json<{ name: string }[]>().map((p) => p.name)).toEqual([
      "New",
      "Old",
    ]);
  });

  it("rejects duplicate names, also case-insensitively where the file system is", async () => {
    await create("Paper");
    expect((await create("Paper")).json()).toMatchObject({
      code: "project_exists",
    });
  });

  it.each(["", "../escape", "a/b", ".hidden", "CON", "x:y", "a\\b"])(
    "rejects the name %j",
    async (name) => {
      const res = await create(name);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: "invalid_name" });
      expect(readdirSync(workspace)).toEqual([]);
    },
  );

  it("returns 404 for unknown or invalid project names in URLs", async () => {
    expect((await call(app, "GET", url("nope"))).statusCode).toBe(404);
    expect(
      (await call(app, "GET", "/api/projects/..%2F..%2Fetc")).statusCode,
    ).toBe(400);
  });

  it("renames, including a case-only rename", async () => {
    await create("draft");
    const renamed = await call(app, "PATCH", url("draft"), { name: "Draft" });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "Draft" });
    expect(readdirSync(workspace)).toEqual(["Draft"]);

    await create("Other");
    expect(
      (await call(app, "PATCH", url("Draft"), { name: "Other" })).json(),
    ).toMatchObject({
      code: "project_exists",
    });
  });

  it("duplicates all files under a free name", async () => {
    await create("Paper");
    mkdirSync(join(workspace, "Paper", "figs"));
    writeFileSync(join(workspace, "Paper", "figs", "a.png"), "png");

    const first = await call(app, "POST", `${url("Paper")}/duplicate`, {});
    const second = await call(app, "POST", `${url("Paper")}/duplicate`, {});
    const named = await call(app, "POST", `${url("Paper")}/duplicate`, {
      name: "Paper v2",
    });

    expect(first.json()).toMatchObject({ name: "Copy of Paper" });
    expect(second.json()).toMatchObject({ name: "Copy of Paper (2)" });
    expect(named.json()).toMatchObject({ name: "Paper v2" });
    expect(
      readFileSync(join(workspace, "Copy of Paper", "figs", "a.png"), "utf8"),
    ).toBe("png");
  });

  it("deletes into the trash and restores", async () => {
    await create("Gone");
    expect((await call(app, "DELETE", url("Gone"))).statusCode).toBe(204);
    expect(existsSync(join(workspace, "Gone"))).toBe(false);
    expect((await call(app, "GET", "/api/projects")).json()).toEqual([]);

    const trash = (await call(app, "GET", "/api/trash")).json<
      {
        entry: string;
        name: string;
      }[]
    >();
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ name: "Gone" });
    expect(existsSync(join(workspace, ".trash", trash[0]?.entry ?? ""))).toBe(
      true,
    );

    const restored = await call(
      app,
      "POST",
      `/api/trash/${encodeURIComponent(trash[0]?.entry ?? "")}/restore`,
    );
    expect(restored.statusCode).toBe(200);
    expect(existsSync(join(workspace, "Gone", "main.tex"))).toBe(true);
  });

  it("does not restore over an existing project", async () => {
    await create("Twin");
    await call(app, "DELETE", url("Twin"));
    await create("Twin");
    const [entry] = (await call(app, "GET", "/api/trash")).json<
      {
        entry: string;
      }[]
    >();
    const res = await call(
      app,
      "POST",
      `/api/trash/${encodeURIComponent(entry?.entry ?? "")}/restore`,
    );
    expect(res.json()).toMatchObject({ code: "project_exists" });
  });

  it("rejects unknown or malformed trash entries", async () => {
    expect(
      (await call(app, "POST", "/api/trash/nothing~20260101T000000Z/restore"))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(app, "POST", "/api/trash/..%2F..%2Fetc/restore")).statusCode,
    ).toBe(400);
  });
});

describe("project settings", () => {
  it("stores main file and compiler in .texcollab.json", async () => {
    await create("P");
    writeFileSync(join(workspace, "P", "thesis.tex"), "x");

    const res = await call(app, "PATCH", url("P"), {
      mainFile: "thesis.tex",
      compiler: "lualatex",
    });

    expect(res.json()).toMatchObject({
      mainFile: "thesis.tex",
      compiler: "lualatex",
    });
    expect(
      JSON.parse(readFileSync(join(workspace, "P", ".texcollab.json"), "utf8")),
    ).toEqual({
      mainFile: "thesis.tex",
      compiler: "lualatex",
    });
  });

  it("validates main file and compiler", async () => {
    await create("P");
    writeFileSync(join(workspace, "P", "notes.md"), "x");
    expect(
      (await call(app, "PATCH", url("P"), { mainFile: "missing.tex" })).json(),
    ).toMatchObject({
      code: "file_not_found",
    });
    expect(
      (await call(app, "PATCH", url("P"), { mainFile: "notes.md" })).statusCode,
    ).toBe(400);
    expect(
      (
        await call(app, "PATCH", url("P"), { mainFile: "../escape.tex" })
      ).json(),
    ).toMatchObject({
      code: "invalid_path",
    });
    expect(
      (await call(app, "PATCH", url("P"), { compiler: "bash" })).statusCode,
    ).toBe(400);
    expect((await call(app, "PATCH", url("P"), {})).statusCode).toBe(400);
  });

  it("falls back to main.tex, then the first root .tex file", async () => {
    mkdirSync(join(workspace, "Imported"));
    writeFileSync(join(workspace, "Imported", "b.tex"), "x");
    writeFileSync(join(workspace, "Imported", "a.tex"), "x");
    writeFileSync(join(workspace, "Imported", ".texcollab.json"), "{ not json");
    expect((await call(app, "GET", url("Imported"))).json()).toMatchObject({
      mainFile: "a.tex",
      compiler: "pdflatex",
    });

    mkdirSync(join(workspace, "Empty"));
    expect((await call(app, "GET", url("Empty"))).json()).toMatchObject({
      mainFile: null,
    });
  });
});
