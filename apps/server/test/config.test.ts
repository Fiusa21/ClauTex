import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultWorkspace, loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("defaults to port 8765 and the default workspace", () => {
    const config = loadConfig([], {});
    expect(config.port).toBe(8765);
    expect(config.workspace).toBe(defaultWorkspace(homedir()));
    expect(config.devOrigins).toEqual([]);
  });

  it("puts the default workspace in Documents when that folder exists", () => {
    expect(defaultWorkspace("/home/me", () => true)).toBe(
      join("/home/me", "Documents", "TexCollab"),
    );
    expect(defaultWorkspace("/home/me", () => false)).toBe(
      join("/home/me", "TexCollab"),
    );
  });

  it("prefers flags over environment variables", () => {
    const config = loadConfig(["--port", "9000", "--workspace", "ws"], {
      TEXCOLLAB_PORT: "9100",
      TEXCOLLAB_WORKSPACE: "/env",
    });
    expect(config.port).toBe(9000);
    expect(config.workspace).toBe(resolve("ws"));
  });

  it("reads environment variables", () => {
    const config = loadConfig([], {
      TEXCOLLAB_PORT: "9100",
      TEXCOLLAB_WORKSPACE: "envws",
    });
    expect(config.port).toBe(9100);
    expect(config.workspace).toBe(resolve("envws"));
  });

  it("allows the Vite dev server in --dev", () => {
    expect(loadConfig(["--dev"], {}).devOrigins).toContain(
      "http://localhost:5173",
    );
  });

  it("rejects invalid ports and unknown flags", () => {
    expect(() => loadConfig(["--port", "0"], {})).toThrow(/Invalid port/);
    expect(() => loadConfig(["--nope"], {})).toThrow();
  });
});
