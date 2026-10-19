import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";

export const PORT = 8765;
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
    devOrigins: [],
    ...overrides,
  });
  return { app, root, workspace };
}
