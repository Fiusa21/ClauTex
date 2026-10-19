import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";

export const PORT = 8765;

/** A stand-in for the docker CLI (see fake-docker.mjs); its first argument is a state folder. */
export const FAKE_DOCKER = [
  process.execPath,
  join(import.meta.dirname, "fake-docker.mjs"),
];

/** A cross-platform stand-in for latexmk (see fake-latexmk.mjs). */
export const FAKE_LATEXMK = [
  process.execPath,
  join(import.meta.dirname, "fake-latexmk.mjs"),
];
export const HOST = `localhost:${String(PORT)}`;

/** An app with a temporary workspace and a minimal built web app. */
export async function testApp(overrides: Partial<Config> = {}) {
  const root = mkdtempSync(join(tmpdir(), "texcollab-test-"));
  const webDist = join(root, "dist");
  mkdirSync(join(webDist, "assets"), { recursive: true });
  writeFileSync(
    join(webDist, "index.html"),
    "<!doctype html><title>TexCollab</title>",
  );
  writeFileSync(join(webDist, "assets", "app-abc123.js"), "console.log(1)");
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const app = await buildApp({
    port: PORT,
    workspace,
    webDist,
    workspaceLocked: true,
    devOrigins: [],
    configDir: join(root, "config"),
    cacheDir: join(root, "cache"),
    latexmk: FAKE_LATEXMK,
    docker: [...FAKE_DOCKER, join(root, "docker-state")],
    dockerImage: "texlive/texlive:test",
    ...overrides,
  });
  return { app, root, workspace };
}

/** inject() with the Host header the guard requires. */
export function call(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    headers: { host: HOST },
    ...(payload === undefined ? {} : { payload }),
  });
}

/** multipart/form-data upload of one file in the "file" field. */
export function upload(
  app: FastifyInstance,
  url: string,
  fileName: string,
  content: Buffer | string,
) {
  const boundary = "----texcollab-test";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url,
    headers: {
      host: HOST,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

/** Creates a directory symlink (a junction on Windows, which needs no admin rights). */
export function linkDir(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}
