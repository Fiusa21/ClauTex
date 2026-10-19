import { posix } from "node:path";

/**
 * Extracts errors and warnings from a TeX log (SPEC §6.1). Compiles run with `-file-line-error` and
 * `max_print_line=10000`, so lines are not wrapped and errors carry `file:line:`.
 *
 * Paths are mapped back to project paths: relative ones against the main file's folder, absolute ones inside the
 * project made relative; anything else (TeX distribution files) is kept as is but never mapped outside the project.
 */

export interface Issue {
  level: "error" | "warning";
  file: string | null;
  line: number | null;
  message: string;
}

export const MAX_ISSUES = 100;

const FILE_LINE_ERROR =
  /^((?:[A-Za-z]:)?\.{0,2}[/\\]?[^:\s][^:]*?\.\w+):(\d{1,9}): (.+)$/;
const BANG_ERROR = /^! (.+)$/;
const LINE_REF = /^l\.(\d{1,9})/;
const WARNING = /^(?:LaTeX|Package \S+|Class \S+) Warning: (.+?)\.?$/;
const INPUT_LINE = /on input line (\d{1,9})/;
const BADBOX =
  /^((?:Overfull|Underfull) \\[hv]box .*?) (?:in paragraph |in alignment |detected )?at lines? (\d{1,9})(?:--\d+)?/;
const FILE_OPEN = /\(((?:[A-Za-z]:)?(?:\.{1,2}[/\\]|[/\\])?[^()\s]+\.\w+)/y;

/** TeX's own follow-ups after a real error. */
const isFollowUp = (message: string) =>
  message.startsWith("==> Fatal error occurred") ||
  message.startsWith("Emergency stop");

export class LogParser {
  private readonly mainDir: string;
  private readonly mainFile: string;
  /** Project root as it appears in absolute log paths ("/"-separated, lower-cased on Windows). */
  private readonly root: string;

  constructor(opts: { mainFile: string; projectRoot: string }) {
    this.mainFile = opts.mainFile;
    const slash = opts.mainFile.lastIndexOf("/");
    this.mainDir = slash < 0 ? "" : opts.mainFile.slice(0, slash);
    this.root = this.comparable(
      opts.projectRoot.replace(/\\/g, "/").replace(/\/$/, ""),
    );
  }

  parse(log: string): Issue[] {
    const issues = new Map<string, Issue>();
    const add = (issue: Issue) => {
      if (issues.size < MAX_ISSUES) issues.set(JSON.stringify(issue), issue);
    };
    const files: string[] = [];
    const lines = log.split(/\r?\n/);
    let hadError = false;

    for (let i = 0; i < lines.length && issues.size < MAX_ISSUES; i++) {
      const line = lines[i] ?? "";

      let m = FILE_LINE_ERROR.exec(line);
      if (m?.[1] && m[2] && m[3] && !line.startsWith("(")) {
        const message = m[3].trim();
        if (!(isFollowUp(message) && hadError)) {
          add({
            level: "error",
            file: this.toProjectPath(m[1]),
            line: Number(m[2]),
            message,
          });
        }
        hadError = true;
        continue;
      }
      m = BANG_ERROR.exec(line);
      if (m?.[1]) {
        const message = m[1].trim();
        if (!(isFollowUp(message) && hadError)) {
          add({
            level: "error",
            file: this.current(files),
            line: lineRef(lines, i),
            message,
          });
        }
        hadError = true;
        continue;
      }
      m = WARNING.exec(line);
      if (m?.[1]) {
        const at = INPUT_LINE.exec(m[1]);
        add({
          level: "warning",
          file: this.current(files),
          line: at?.[1] ? Number(at[1]) : null,
          message: m[1],
        });
        continue;
      }
      m = BADBOX.exec(line);
      if (m?.[1] && m[2]) {
        add({
          level: "warning",
          file: this.current(files),
          line: Number(m[2]),
          message: m[1],
        });
        continue;
      }
      trackFiles(line, files);
    }
    return [...issues.values()];
  }

  /** Maps a path from the log to a project path; returns it unchanged if it is outside the project. */
  toProjectPath(raw: string): string {
    const path = raw.replace(/\\/g, "/");
    const isAbsolute = path.startsWith("/") || /^[A-Za-z]:\//.test(path);
    if (isAbsolute) {
      const comparable = this.comparable(path);
      if (comparable.startsWith(`${this.root}/`))
        return path.slice(this.root.length + 1);
      return raw;
    }
    const joined = posix.normalize(posix.join(this.mainDir || ".", path));
    return joined.startsWith("../") || joined === ".." ? raw : joined;
  }

  private current(files: string[]): string {
    for (let i = files.length - 1; i >= 0; i--) {
      const f = files[i];
      if (f) return this.toProjectPath(f);
    }
    return this.mainFile;
  }

  private comparable(path: string): string {
    return /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path;
  }
}

/** Maintains the stack of open input files from "(file" and ")" in a log line. */
function trackFiles(line: string, files: string[]): void {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "(") {
      FILE_OPEN.lastIndex = i;
      const m = FILE_OPEN.exec(line);
      if (m?.[1]) {
        files.push(m[1]);
        i = FILE_OPEN.lastIndex - 1;
      } else {
        files.push(""); // a parenthesis that is not a file still needs its ")"
      }
    } else if (c === ")" && files.length > 0) {
      files.pop();
    }
  }
}

/** Line of a "!" error: the following "l.123", or TeX's "file:N:" follow-up. */
function lineRef(lines: string[], from: number): number | null {
  for (let j = from + 1; j < Math.min(lines.length, from + 25); j++) {
    const line = lines[j] ?? "";
    const ref = LINE_REF.exec(line);
    if (ref?.[1]) return Number(ref[1]);
    const next = FILE_LINE_ERROR.exec(line);
    if (next?.[2] && next[3])
      return isFollowUp(next[3].trim()) ? Number(next[2]) : null;
    if (line.startsWith("!")) break;
  }
  return null;
}
