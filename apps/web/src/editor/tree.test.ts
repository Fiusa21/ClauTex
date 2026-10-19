import { describe, expect, it } from "vitest";
import type { FileEntry } from "../api/files.ts";
import { ancestors, buildTree, folderOf, join } from "./tree.ts";

const f = (path: string, kind: FileEntry["kind"] = "doc"): FileEntry => ({
  id: path,
  path,
  kind,
  size: null,
  mtime: "2026-10-19T10:00:00Z",
});

describe("buildTree", () => {
  it("nests files under folders, folders first, natural order", () => {
    const tree = buildTree([
      f("main.tex"),
      f("chapters", "folder"),
      f("chapters/ch10.tex"),
      f("chapters/ch2.tex"),
      f("a.bib"),
      f("figures", "folder"),
    ]);
    expect(tree.map((n) => n.name)).toEqual([
      "chapters",
      "figures",
      "a.bib",
      "main.tex",
    ]);
    expect(tree[0]?.children.map((n) => n.name)).toEqual([
      "ch2.tex",
      "ch10.tex",
    ]);
  });
});

describe("path helpers", () => {
  it("folderOf", () => {
    expect(folderOf(undefined, false)).toBe("");
    expect(folderOf("main.tex", false)).toBe("");
    expect(folderOf("a/b/c.tex", false)).toBe("a/b");
    expect(folderOf("a/b", true)).toBe("a/b");
  });

  it("join and ancestors", () => {
    expect(join("", "x.tex")).toBe("x.tex");
    expect(join("a", "x.tex")).toBe("a/x.tex");
    expect(ancestors("a/b/c.tex")).toEqual(["a", "a/b"]);
    expect(ancestors("c.tex")).toEqual([]);
  });
});
