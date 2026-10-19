import { defineConfig, devices } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// E2E starts the real local server (serving the built web app) against fresh temporary folders:
// workspace, build cache and settings never touch the user's real ones. Workers inherit these env
// vars, so they all see the same folders.
//
// TEXCOLLAB_E2E_SERVER=external runs against a server that is already running on port 8799 (for
// example inside a container with TeX); TEXCOLLAB_E2E_WORKSPACE must then name its workspace.
const external = process.env.TEXCOLLAB_E2E_SERVER === "external";
process.env.TEXCOLLAB_E2E_ROOT ??= mkdtempSync(
  join(tmpdir(), "texcollab-e2e-"),
);
const root = process.env.TEXCOLLAB_E2E_ROOT;
if (!external) process.env.TEXCOLLAB_E2E_WORKSPACE = join(root, "workspace");
const workspace = process.env.TEXCOLLAB_E2E_WORKSPACE ?? "";
mkdirSync(workspace, { recursive: true });
const port = 8799;

// Real TeX only when asked for (TEXCOLLAB_E2E_REAL_TEX=1); otherwise the cross-platform fake latexmk.
const realTex = process.env.TEXCOLLAB_E2E_REAL_TEX === "1";
const fakeDocker = JSON.stringify([
  process.execPath,
  join(import.meta.dirname, "..", "server", "test", "fake-docker.mjs"),
  join(root, "docker-state"),
]);
const fakeLatexmk = JSON.stringify([
  process.execPath,
  join(import.meta.dirname, "..", "server", "test", "fake-latexmk.mjs"),
]);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  // Settings (compile mode, timeout) are global to the server: run tests one after another.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: "retain-on-failure",
  },
  webServer: external
    ? undefined
    : {
        command: `node ../server/src/index.ts --port ${String(port)} --workspace "${workspace}"`,
        url: `http://127.0.0.1:${String(port)}/api/health`,
        reuseExistingServer: false,
        stdout: "pipe",
        timeout: 30_000,
        env: {
          TEXCOLLAB_CACHE_DIR: join(root, "cache"),
          TEXCOLLAB_CONFIG_DIR: join(root, "config"),
          ...(realTex
            ? {}
            : { TEXCOLLAB_LATEXMK: fakeLatexmk, TEXCOLLAB_DOCKER: fakeDocker }),
        },
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
