import { existsSync, mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "../src/server.ts";
import { FAKE_LATEXMK } from "./helpers.ts";

describe("startServer", () => {
  it("creates the workspace and listens on 127.0.0.1 only", async () => {
    const workspace = join(
      mkdtempSync(join(tmpdir(), "texcollab-listen-")),
      "new",
      "workspace",
    );
    const app = await startServer({
      port: 0,
      workspace,
      webDist: "/nonexistent",
      devOrigins: [],
      configDir: join(workspace, "..", "config"),
      cacheDir: join(workspace, "..", "cache"),
      latexmk: FAKE_LATEXMK,
    });
    try {
      const address = app.server.address() as AddressInfo;
      expect(address.address).toBe("127.0.0.1");
      expect(existsSync(workspace)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
