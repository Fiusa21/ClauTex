import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizePath,
  normalizeProjectName,
  resolveInside,
} from "../src/paths.ts";
import { linkDir } from "./helpers.ts";

describe("normalizePath", () => {
  it.each([
    "main.tex",
    "chapters/intro.tex",
    "figures/a b/plot.png",
    "..hidden.tex",
    "a..b/c.tex",
    "ümlaut.tex",
    "-x.tex",
  ])("accepts %s", (path) => {
    expect(normalizePath(path)).toBe(path);
  });

  it.each([
    ["empty", ""],
    ["parent", ".."],
    ["traversal", "../x"],
    ["nested traversal", "a/../../x"],
    ["dot segment", "./x"],
    ["absolute", "/etc/passwd"],
    ["UNC", "//server/share"],
    ["backslash", "a\\b"],
    ["drive", "C:/x"],
    ["drive relative", "c:x"],
    ["empty segment", "a//b"],
    ["trailing slash", "a/"],
    ["NUL", "a\u0000b"],
    ["newline", "a\nb"],
    ["leading space", " a"],
    ["trailing dot", "a."],
    ["Windows reserved", "CON"],
    ["Windows reserved with extension", "aux.tex"],
    ["Windows reserved in folder", "nul/x.tex"],
    ["COM port", "com1.txt"],
    ["forbidden char", "a:b"],
    ["forbidden char", "what?.tex"],
    ["forbidden char", "a*b"],
    ["too long segment", "a".repeat(256)],
    ["too long path", `${"d".repeat(200)}/`.repeat(6) + "x.tex"],
    ["not a string", 42],
  ])("rejects %s", (_label, path) => {
    expect(() => normalizePath(path)).toThrow(
      expect.objectContaining({ code: "invalid_path" }),
    );
  });

  it("rejects Unicode line separators", () => {
    expect(() => normalizePath(`a${String.fromCharCode(0x2028)}b`)).toThrow();
  });

  it("normalizes to NFC", () => {
    expect(normalizePath("u\u0308.tex")).toBe("\u00fc.tex");
  });
});

describe("normalizeProjectName", () => {
  it("accepts ordinary names", () => {
    expect(normalizeProjectName("Master thesis (2026)")).toBe(
      "Master thesis (2026)",
    );
  });

  it.each([
    "",
    "a/b",
    "..",
    ".hidden",
    "CON",
    "x:y",
    "a".repeat(121),
    " padded",
  ])("rejects %j", (name) => {
    expect(() => normalizeProjectName(name)).toThrow(
      expect.objectContaining({ code: "invalid_name" }),
    );
  });
});

describe("resolveInside", () => {
  function setup() {
    const base = mkdtempSync(join(tmpdir(), "texcollab-paths-"));
    const project = join(base, "project");
    const outside = join(base, "outside");
    mkdirSync(join(project, "inner"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "secret");
    return { project, outside };
  }

  it("resolves existing and new paths inside the project", async () => {
    const { project } = setup();
    await expect(resolveInside(project, "inner")).resolves.toMatch(/inner$/);
    await expect(
      resolveInside(project, "new/deeper/file.tex"),
    ).resolves.toMatch(/file\.tex$/);
  });

  it("refuses symlinked folders that lead outside", async () => {
    const { project, outside } = setup();
    linkDir(outside, join(project, "escape"));
    await expect(
      resolveInside(project, "escape/secret.txt"),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(
      resolveInside(project, "escape/new.tex"),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(resolveInside(project, "escape")).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("allows symlinks that stay inside the project", async () => {
    const { project } = setup();
    linkDir(join(project, "inner"), join(project, "alias"));
    await expect(resolveInside(project, "alias/x.tex")).resolves.toMatch(
      /x\.tex$/,
    );
  });
});
