import { describe, expect, it } from "vitest";
import { LogParser, MAX_ISSUES } from "../src/compile/logParser.ts";

const parser = (
  mainFile = "main.tex",
  projectRoot = "/home/me/TexCollab/Paper",
) => new LogParser({ mainFile, projectRoot });

describe("LogParser", () => {
  it("maps file:line errors in included files to project paths and drops TeX's follow-ups", () => {
    const log = [
      "This is pdfTeX, Version 3.141592653-2.6-1.40.28 (TeX Live 2026)",
      "(./thesis.tex",
      "(/usr/local/texlive/2026/texmf-dist/tex/latex/base/article.cls",
      ") (./chapters/intro.tex",
      "./chapters/intro.tex:12: Undefined control sequence.",
      "l.12 \\foo",
      "./chapters/intro.tex:12:  ==> Fatal error occurred, no output PDF file produced!",
    ].join("\n");
    expect(parser("src/thesis.tex").parse(log)).toEqual([
      {
        level: "error",
        file: "src/chapters/intro.tex",
        line: 12,
        message: "Undefined control sequence.",
      },
    ]);
  });

  it("uses the current input file and l.N for ! errors", () => {
    const log = [
      "(./main.tex (./included.tex",
      "! Missing $ inserted.",
      "<inserted text>",
      "l.7 x^",
      "))",
    ].join("\n");
    expect(parser().parse(log)).toEqual([
      {
        level: "error",
        file: "included.tex",
        line: 7,
        message: "Missing $ inserted.",
      },
    ]);
  });

  it("takes the line of a missing-file error from TeX's follow-up", () => {
    const log = [
      "(./shell.tex",
      "! LaTeX Error: File `pwned.tex' not found.",
      "",
      "Type X to quit or <RETURN> to proceed,",
      "Enter file name: ",
      "./shell.tex:4: Emergency stop.",
      "l.4 \\input{pwned}",
    ].join("\n");
    expect(parser("shell.tex").parse(log)).toEqual([
      {
        level: "error",
        file: "shell.tex",
        line: 4,
        message: "LaTeX Error: File `pwned.tex' not found.",
      },
    ]);
  });

  it("reports warnings and bad boxes", () => {
    const log = [
      "(./main.tex",
      "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 23.",
      "Overfull \\hbox (12.3pt too wide) in paragraph at lines 40--42",
      "Underfull \\vbox (badness 10000) detected at line 51",
      "LaTeX Warning: There were undefined references.",
      ")",
    ].join("\n");
    expect(parser().parse(log)).toEqual([
      {
        level: "warning",
        file: "main.tex",
        line: 23,
        message: "Reference `fig:x' on page 1 undefined on input line 23",
      },
      {
        level: "warning",
        file: "main.tex",
        line: 40,
        message: "Overfull \\hbox (12.3pt too wide)",
      },
      {
        level: "warning",
        file: "main.tex",
        line: 51,
        message: "Underfull \\vbox (badness 10000)",
      },
      {
        level: "warning",
        file: "main.tex",
        line: null,
        message: "There were undefined references",
      },
    ]);
  });

  it("maps absolute paths inside the project, including Windows paths", () => {
    expect(
      parser().toProjectPath("/home/me/TexCollab/Paper/chapters/a.tex"),
    ).toBe("chapters/a.tex");
    expect(parser().toProjectPath("/usr/share/texmf/tex/x.sty")).toBe(
      "/usr/share/texmf/tex/x.sty",
    );
    const windows = parser(
      "main.tex",
      "C:\\Users\\Me\\Documents\\TexCollab\\Paper",
    );
    expect(
      windows.toProjectPath(
        "c:/Users/Me/Documents/TexCollab/Paper/chapters/a.tex",
      ),
    ).toBe("chapters/a.tex");
    expect(
      windows.toProjectPath(
        "C:\\Users\\Me\\Documents\\TexCollab\\Paper\\b.tex",
      ),
    ).toBe("b.tex");
    expect(
      windows.parse("C:/Users/Me/Documents/TexCollab/Paper/main.tex:5: Oops."),
    ).toEqual([
      { level: "error", file: "main.tex", line: 5, message: "Oops." },
    ]);
  });

  it("never maps paths outside the project", () => {
    const p = parser("a/b/main.tex");
    expect(p.toProjectPath("./x.tex")).toBe("a/b/x.tex");
    expect(p.toProjectPath("../c/y.tex")).toBe("a/c/y.tex");
    expect(p.toProjectPath("../../../etc/passwd")).toBe("../../../etc/passwd");
  });

  it("caps and deduplicates issues", () => {
    const log =
      "./main.tex:1: Same.\n".repeat(5) +
      Array.from(
        { length: 500 },
        (_, i) => `./main.tex:${String(i)}: E${String(i)}.`,
      ).join("\n");
    const issues = parser().parse(log);
    expect(issues).toHaveLength(MAX_ISSUES);
    expect(new Set(issues.map((i) => JSON.stringify(i))).size).toBe(MAX_ISSUES);
  });
});
