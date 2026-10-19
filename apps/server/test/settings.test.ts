import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, testApp } from "./helpers.ts";

let app: FastifyInstance;
let root: string;
let workspace: string;

beforeEach(async () => {
  ({ app, root, workspace } = await testApp({ workspaceLocked: false }));
});

afterEach(async () => {
  await app.close();
});

interface Settings {
  compileTimeoutSeconds: number;
  compileMode: string;
  workspace: string;
  workspaceLocked: boolean;
}

describe("settings", () => {
  it("has defaults and stores changes in the config folder", async () => {
    expect((await call(app, "GET", "/api/settings")).json()).toEqual({
      compileTimeoutSeconds: 120,
      compileMode: "local",
      workspace,
      workspaceLocked: false,
    });
    const res = await call(app, "PATCH", "/api/settings", {
      compileTimeoutSeconds: 300,
      compileMode: "docker",
    });
    expect(res.json()).toMatchObject({
      compileTimeoutSeconds: 300,
      compileMode: "docker",
    });
    expect(
      JSON.parse(readFileSync(join(root, "config", "settings.json"), "utf8")),
    ).toMatchObject({
      compileTimeoutSeconds: 300,
      compileMode: "docker",
    });
  });

  it.each([
    { compileTimeoutSeconds: 5 },
    { compileTimeoutSeconds: 5000 },
    { compileTimeoutSeconds: 1.5 },
    { compileTimeoutSeconds: "60" },
    { compileMode: "cloud" },
    { workspace: "relative/path" },
  ])("rejects %j", async (body) => {
    expect((await call(app, "PATCH", "/api/settings", body)).statusCode).toBe(
      400,
    );
  });

  it("switches the workspace, creating the folder, and remembers it", async () => {
    const other = join(
      mkdtempSync(join(tmpdir(), "texcollab-ws-")),
      "Other workspace",
    );
    const res = await call(app, "PATCH", "/api/settings", { workspace: other });

    expect(res.statusCode).toBe(200);
    expect(existsSync(other)).toBe(true);
    await call(app, "POST", "/api/projects", { name: "In other" });
    expect(existsSync(join(other, "In other", "main.tex"))).toBe(true);
    expect(
      (await call(app, "GET", "/api/health")).json<{ workspace: string }>()
        .workspace,
    ).toBe(other);

    // A restarted app uses the stored workspace.
    await app.close();
    ({ app } = await testApp({
      workspaceLocked: false,
      configDir: join(root, "config"),
    }));
    expect(
      (await call(app, "GET", "/api/settings")).json<Settings>().workspace,
    ).toContain("Other workspace");
  });

  it("cannot change a workspace given on the command line", async () => {
    await app.close();
    ({ app } = await testApp({ workspaceLocked: true }));
    const res = await call(app, "PATCH", "/api/settings", {
      workspace: join(tmpdir(), "x"),
    });
    expect(res.json()).toMatchObject({ code: "workspace_locked" });
  });
});

describe("opened folders", () => {
  function externalFolder(): string {
    const dir = join(
      mkdtempSync(join(tmpdir(), "texcollab-ext-")),
      "My thesis",
    );
    mkdirSync(join(dir, "chapters"), { recursive: true });
    writeFileSync(join(dir, "thesis.tex"), "\\documentclass{article}\n");
    writeFileSync(join(dir, "chapters", "one.tex"), "One");
    return dir;
  }

  it("opens a folder outside the workspace as a project", async () => {
    const dir = externalFolder();
    const res = await call(app, "POST", "/api/folders", { path: dir });

    expect(res.statusCode).toBe(201);
    const project = res.json<{
      id: string;
      name: string;
      external: boolean;
      mainFile: string;
    }>();
    expect(project).toMatchObject({
      name: "My thesis",
      external: true,
      mainFile: "thesis.tex",
    });
    expect(project.id).toMatch(/^ext:[0-9a-f]{16}$/);

    const list = (await call(app, "GET", "/api/projects")).json<
      { id: string }[]
    >();
    expect(list.map((p) => p.id)).toContain(project.id);

    const id = encodeURIComponent(project.id);
    const files = (await call(app, "GET", `/api/projects/${id}/files`)).json<
      { path: string }[]
    >();
    expect(files.map((f) => f.path)).toEqual([
      "chapters",
      "chapters/one.tex",
      "thesis.tex",
    ]);

    const text = await call(
      app,
      "GET",
      `/api/projects/${id}/files/text?path=thesis.tex`,
    );
    const { etag } = text.json<{ etag: string }>();
    await call(app, "PUT", `/api/projects/${id}/files/text?path=thesis.tex`, {
      text: "edited\n",
      baseEtag: etag,
    });
    expect(readFileSync(join(dir, "thesis.tex"), "utf8")).toBe("edited\n");

    const build = await call(app, "POST", `/api/projects/${id}/compile`);
    expect(build.json()).toMatchObject({ status: "success" });
  });

  it("cannot rename or delete an opened folder, but can duplicate it into the workspace", async () => {
    const dir = externalFolder();
    const { id } = (
      await call(app, "POST", "/api/folders", { path: dir })
    ).json<{ id: string }>();
    const url = `/api/projects/${encodeURIComponent(id)}`;

    expect((await call(app, "PATCH", url, { name: "x" })).json()).toMatchObject(
      { code: "not_supported_for_folders" },
    );
    expect((await call(app, "DELETE", url)).json()).toMatchObject({
      code: "not_supported_for_folders",
    });
    expect(existsSync(dir)).toBe(true);

    const copy = await call(app, "POST", `${url}/duplicate`, {});
    expect(copy.json()).toMatchObject({
      name: "Copy of My thesis",
      external: false,
    });
    expect(
      existsSync(join(workspace, "Copy of My thesis", "chapters", "one.tex")),
    ).toBe(true);
  });

  it("deleted files of an opened folder go to the workspace trash", async () => {
    const dir = externalFolder();
    const { id } = (
      await call(app, "POST", "/api/folders", { path: dir })
    ).json<{ id: string }>();
    const res = await call(
      app,
      "DELETE",
      `/api/projects/${encodeURIComponent(id)}/files?path=chapters`,
    );
    expect(res.statusCode).toBe(204);
    expect(existsSync(join(dir, "chapters"))).toBe(false);
    expect(existsSync(join(workspace, ".trash", "My thesis"))).toBe(true);
  });

  it("lists and removes folders without touching them on disk", async () => {
    const dir = externalFolder();
    await call(app, "POST", "/api/folders", { path: dir });
    const listed = (await call(app, "GET", "/api/folders")).json<
      { path: string; exists: boolean }[]
    >();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.exists).toBe(true);

    await call(
      app,
      "DELETE",
      `/api/folders?path=${encodeURIComponent(listed[0]?.path ?? "")}`,
    );
    expect((await call(app, "GET", "/api/folders")).json()).toEqual([]);
    expect(existsSync(join(dir, "thesis.tex"))).toBe(true);
  });

  it.each([
    ["a relative path", "relative/thesis", 400],
    ["a missing folder", join(tmpdir(), "texcollab-does-not-exist"), 404],
    ["the home folder", homedir(), 400],
  ])("refuses %s", async (_label, path, status) => {
    expect((await call(app, "POST", "/api/folders", { path })).statusCode).toBe(
      status,
    );
  });

  it("refuses the workspace and folders inside it", async () => {
    await call(app, "POST", "/api/projects", { name: "Inside" });
    expect(
      (
        await call(app, "POST", "/api/folders", {
          path: join(workspace, "Inside"),
        })
      ).json(),
    ).toMatchObject({
      code: "inside_workspace",
    });
    expect(
      (await call(app, "POST", "/api/folders", { path: workspace })).statusCode,
    ).toBe(409);
  });

  it("does not resolve unknown ext ids", async () => {
    expect(
      (await call(app, "GET", "/api/projects/ext%3A0123456789abcdef"))
        .statusCode,
    ).toBe(404);
  });
});
