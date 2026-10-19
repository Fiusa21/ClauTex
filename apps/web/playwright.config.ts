import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// E2E starts the real local server (serving the built web app) against a fresh, temporary
// workspace. Workers inherit this env var, so they all see the same folder.
process.env.TEXCOLLAB_E2E_WORKSPACE ??= mkdtempSync(
  join(tmpdir(), "texcollab-e2e-"),
);
const workspace = process.env.TEXCOLLAB_E2E_WORKSPACE;
const port = 8799;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node ../server/src/index.ts --port ${String(port)} --workspace "${workspace}"`,
    url: `http://127.0.0.1:${String(port)}/api/health`,
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
