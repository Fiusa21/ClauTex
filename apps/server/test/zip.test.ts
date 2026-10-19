import { zipSync, unzipSync } from "fflate";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOST, call, testApp } from "./helpers.ts";

let app: FastifyInstance;
let workspace: string;

beforeEach(async () => {
  ({ app, workspace } = await testApp());
});

afterEach(async () => {
  await app.close();
});

function importZip(
  zip: Uint8Array | Buffer,
  fileName = "project.zip",
  name?: string,
) {
  const boundary = "----texcollab-zip";
  const parts: Buffer[] = [];
  if (name !== undefined) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`,
    ),
    Buffer.from(zip),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return app.inject({
    method: "POST",
    url: "/api/projects/import",
    headers: {
      host: HOST,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat(parts),
  });
}

/** All files below a folder, as relative path → bytes (hidden entries included). */
function snapshot(dir: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out[`${path}/`] = "";
      Object.assign(out, snapshot(dir, path));
    } else {
      out[path] = readFileSync(join(dir, path)).toString("base64");
    }
  }
  return out;
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("export and import", () => {
  it("round-trips all files, folders and project settings byte for byte", async () => {
    await call(app, "POST", "/api/projects", { name: "Thesis" });
    const dir = join(workspace, "Thesis");
    mkdirSync(join(dir, "chapters", "deep"), { recursive: true });
    mkdirSync(join(dir, "empty"));
    writeFileSync(
      join(dir, "chapters", "deep", "a.tex"),
      "Grüße\r\nwith CRLF\r\n",
    );
    writeFileSync(join(dir, "figure.png"), randomBytes(200_000));
    writeFileSync(join(dir, "thesis.tex"), "\\documentclass{article}\n");
    await call(app, "PATCH", "/api/projects/Thesis", {
      mainFile: "thesis.tex",
      compiler: "xelatex",
    });
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "config"), "secret");

    const exported = await call(app, "GET", "/api/projects/Thesis/export.zip");
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toBe("application/zip");
    expect(exported.headers["content-disposition"]).toContain(
      'filename="Thesis.zip"',
    );
    const zip = exported.rawPayload;
    expect(Object.keys(unzipSync(zip)).sort()).not.toContain(".git/config");

    const imported = await importZip(zip, "Thesis.zip", "Thesis copy");
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      name: "Thesis copy",
      mainFile: "thesis.tex",
      compiler: "xelatex",
    });

    const original = snapshot(dir);
    delete original[".git/"];
    delete original[".git/config"];
    expect(snapshot(join(workspace, "Thesis copy"))).toEqual(original);
  });

  it("strips a single top-level folder and skips macOS and hidden entries", async () => {
    const zip = zipSync({
      "paper-main/main.tex": enc("\\documentclass{article}"),
      "paper-main/ch/one.tex": enc("one"),
      "paper-main/.DS_Store": enc("x"),
      "paper-main/.git/HEAD": enc("x"),
      "__MACOSX/paper-main/._main.tex": enc("x"),
    });
    const res = await importZip(zip, "paper-main.zip");

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: "paper-main",
      mainFile: "main.tex",
    });
    expect(Object.keys(snapshot(join(workspace, "paper-main"))).sort()).toEqual(
      ["ch/", "ch/one.tex", "main.tex"],
    );
  });

  it("uses a free name derived from the file name", async () => {
    const zip = zipSync({ "main.tex": enc("x") });
    expect((await importZip(zip, "My: paper.zip")).json()).toMatchObject({
      name: "My- paper",
    });
    expect((await importZip(zip, "My: paper.zip")).json()).toMatchObject({
      name: "My- paper (2)",
    });
    expect((await importZip(zip, "x.zip", "My- paper")).json()).toMatchObject({
      code: "project_exists",
    });
  });

  it.each([
    "../evil.tex",
    "a/../../evil.tex",
    "/etc/evil.tex",
    "C:/evil.tex",
    "CON.tex",
    "what?.tex",
  ])("rejects the entry %s and writes nothing", async (entry) => {
    const zip = zipSync({ "main.tex": enc("x"), [entry]: enc("evil") });
    const res = await importZip(zip, "evil.zip");

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_archive" });
    expect(readdirSync(workspace)).toEqual([]);
    expect(existsSync(join(workspace, "..", "evil.tex"))).toBe(false);
  });

  it("handles names that differ only in case according to the file system", async () => {
    writeFileSync(join(workspace, "probe"), "");
    const caseInsensitive = existsSync(join(workspace, "PROBE"));
    const { rmSync } = await import("node:fs");
    rmSync(join(workspace, "probe"));

    const res = await importZip(
      zipSync({ "A.tex": enc("upper"), "a.tex": enc("lower") }),
      "case.zip",
    );

    if (caseInsensitive) {
      expect(res.json()).toMatchObject({ code: "invalid_archive" });
      expect(readdirSync(workspace)).toEqual([]);
    } else {
      expect(res.statusCode).toBe(201);
    }
  });

  it("rejects archives with too many entries before unpacking", async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= 10_000; i++)
      files[`f${String(i)}.txt`] = new Uint8Array(0);
    const res = await importZip(zipSync(files, { level: 0 }), "many.zip");
    expect(res.statusCode).toBe(413);
    expect(readdirSync(workspace)).toEqual([]);
  });

  it("rejects files that are not ZIPs and empty archives", async () => {
    expect(
      (await importZip(Buffer.from("not a zip"), "x.zip")).json(),
    ).toMatchObject({ code: "invalid_archive" });
    expect(
      (await importZip(zipSync({ "__MACOSX/x": enc("x") }), "x.zip")).json(),
    ).toMatchObject({
      code: "invalid_archive",
    });
  });

  it("404s when exporting an unknown project", async () => {
    expect(
      (await call(app, "GET", "/api/projects/Nope/export.zip")).statusCode,
    ).toBe(404);
  });
});
