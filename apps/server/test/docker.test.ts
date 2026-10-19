import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dockerRunArgs } from "../src/compile/docker.ts";
import { LogParser } from "../src/compile/logParser.ts";
import { call, testApp } from "./helpers.ts";

describe("dockerRunArgs", () => {
  it("builds a sandboxed run with a read-only project and a writable output folder", () => {
    const args = dockerRunArgs({
      name: "texcollab-abc",
      image: "texlive/texlive:x",
      projectDir: "/home/me/Paper",
      outDir: "/home/me/.cache/texcollab/builds/123",
      mainDir: "src",
      latexmkArgs: ["-pdf", "./thesis.tex"],
      user: "501:20",
    });
    const flags = args.join(" ");
    expect(args.slice(0, 4)).toEqual([
      "run",
      "--rm",
      "--name",
      "texcollab-abc",
    ]);
    for (const expected of [
      "--network none",
      "--read-only",
      "--memory 2g",
      "--memory-swap 2g",
      "--cpus 2",
      "--pids-limit 512",
      "--security-opt no-new-privileges",
      "--cap-drop ALL",
      "--user 501:20",
      "--mount type=bind,source=/home/me/Paper,target=/project,readonly",
      "--mount type=bind,source=/home/me/.cache/texcollab/builds/123,target=/out",
      "--workdir /project/src",
      "--env openout_any=p",
    ]) {
      expect(flags).toContain(expected);
    }
    expect(args.slice(-4)).toEqual([
      "texlive/texlive:x",
      "latexmk",
      "-pdf",
      "./thesis.tex",
    ]);
  });

  it("maps container paths in logs back to the project", () => {
    const parser = new LogParser({
      mainFile: "main.tex",
      projectRoot: "/project",
    });
    expect(parser.toProjectPath("/project/chapters/a.tex")).toBe(
      "chapters/a.tex",
    );
  });
});

describe("compiling in Docker", () => {
  let app: FastifyInstance;
  let root: string;
  let workspace: string;

  beforeEach(async () => {
    ({ app, root, workspace } = await testApp());
    await call(app, "POST", "/api/projects", { name: "Paper" });
    await call(app, "PATCH", "/api/settings", { compileMode: "docker" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("asks for the image to be downloaded first, then compiles in the container", async () => {
    const before = await call(app, "POST", "/api/projects/Paper/compile");
    expect(before.statusCode).toBe(503);
    expect(before.json()).toMatchObject({ code: "docker_image_missing" });
    expect((await call(app, "GET", "/api/docker")).json()).toMatchObject({
      available: true,
      version: "27.0.0-fake",
      imagePresent: false,
    });

    await call(app, "POST", "/api/docker/pull");
    await expect
      .poll(
        async () =>
          (await call(app, "GET", "/api/docker")).json<{
            imagePresent: boolean;
          }>().imagePresent,
      )
      .toBe(true);

    const res = await call(app, "POST", "/api/projects/Paper/compile");
    expect(res.json()).toMatchObject({ status: "success", pdfIsFresh: true });
    const runArgs = JSON.parse(
      readFileSync(join(root, "docker-state", "run-args.json"), "utf8"),
    ) as string[];
    expect(runArgs).toContain("texlive/texlive:test");
    expect(runArgs.join(" ")).toContain(
      `source=${realpathSync(join(workspace, "Paper"))},target=/project,readonly`,
    );
    expect(runArgs).toContain("-outdir=/out");
    expect(runArgs).toContain("-no-shell-escape");
  });

  it("removes the container when the compile times out", async () => {
    writeFileSync(join(root, "docker-state-marker"), "");
    await call(app, "POST", "/api/docker/pull");
    await expect
      .poll(
        async () =>
          (await call(app, "GET", "/api/docker")).json<{
            imagePresent: boolean;
          }>().imagePresent,
      )
      .toBe(true);
    await call(app, "PATCH", "/api/settings", { compileTimeoutSeconds: 10 });
    writeFileSync(join(workspace, "Paper", "main.tex"), "SLEEP");

    const res = await call(app, "POST", "/api/projects/Paper/compile");

    expect(res.json()).toMatchObject({ status: "timeout" });
    const runArgs = JSON.parse(
      readFileSync(join(root, "docker-state", "run-args.json"), "utf8"),
    ) as string[];
    const name = runArgs[runArgs.indexOf("--name") + 1];
    expect(
      readFileSync(join(root, "docker-state", "removed.txt"), "utf8"),
    ).toContain(name);
  }, 30_000);

  it("explains when Docker is missing", async () => {
    await app.close();
    ({ app } = await testApp({ docker: [join(root, "no-such-docker")] }));
    await call(app, "POST", "/api/projects", { name: "Paper" });
    await call(app, "PATCH", "/api/settings", { compileMode: "docker" });
    const res = await call(app, "POST", "/api/projects/Paper/compile");
    expect(res.json()).toMatchObject({ code: "docker_unavailable" });
    expect(existsSync(join(root, "docker-state"))).toBe(false);
  });
});
