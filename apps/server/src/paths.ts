import { realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { ApiError } from "./problem.ts";

/**
 * Validation of user-supplied project names and project-relative paths (CLAUDE.md rule 3).
 *
 * Paths in the API are relative, "/"-separated, NFC-normalized, and portable: names that Windows cannot store
 * (reserved device names, `<>:"|?*`, trailing dots/spaces) are rejected on every OS so projects stay usable everywhere.
 */

export const MAX_PATH_LENGTH = 1024;
export const MAX_SEGMENT_LENGTH = 255;
export const MAX_PROJECT_NAME_LENGTH = 120;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;
const FORBIDDEN_CHARS = /[<>:"|?*\\]/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
/** Unicode line and paragraph separators (U+2028, U+2029). */
const LINE_SEPARATORS = [
  String.fromCharCode(0x2028),
  String.fromCharCode(0x2029),
];

function invalid(code: string, detail: string): ApiError {
  return new ApiError(400, code, detail);
}

function checkSegment(segment: string, code: string): void {
  if (segment.length === 0) throw invalid(code, "Names must not be empty.");
  if (segment === "." || segment === "..")
    throw invalid(code, "'.' and '..' are not allowed.");
  if (segment.length > MAX_SEGMENT_LENGTH)
    throw invalid(code, "Name is too long.");
  if (
    CONTROL_CHARS.test(segment) ||
    LINE_SEPARATORS.some((c) => segment.includes(c))
  ) {
    throw invalid(code, "Names must not contain control characters.");
  }
  if (FORBIDDEN_CHARS.test(segment)) {
    throw invalid(code, 'Names must not contain any of < > : " | ? * \\');
  }
  if (segment.trim() !== segment)
    throw invalid(code, "Names must not start or end with spaces.");
  if (segment.endsWith("."))
    throw invalid(code, "Names must not end with a dot.");
  if (WINDOWS_RESERVED.test(segment)) {
    throw invalid(code, `"${segment}" is a reserved name on Windows.`);
  }
}

/** Validates a project-relative path ("chapters/intro.tex") and returns its normalized form. */
export function normalizePath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0)
    throw invalid("invalid_path", "A path is required.");
  const path = raw.normalize("NFC");
  if (path.length > MAX_PATH_LENGTH)
    throw invalid("invalid_path", "Path is too long.");
  if (path.includes("\\"))
    throw invalid("invalid_path", "Paths must use forward slashes.");
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path))
    throw invalid("invalid_path", "Paths must be relative.");
  if (path.endsWith("/"))
    throw invalid("invalid_path", "Paths must not end with a slash.");
  for (const segment of path.split("/")) checkSegment(segment, "invalid_path");
  return path;
}

/** Validates a project (folder) name: one portable segment, not hidden. */
export function normalizeProjectName(raw: unknown): string {
  if (typeof raw !== "string")
    throw invalid("invalid_name", "A project name is required.");
  const name = raw.normalize("NFC");
  if (name.includes("/"))
    throw invalid("invalid_name", "Project names must not contain '/'.");
  checkSegment(name, "invalid_name");
  if (name.startsWith("."))
    throw invalid("invalid_name", "Project names must not start with a dot.");
  if (name.length > MAX_PROJECT_NAME_LENGTH)
    throw invalid("invalid_name", "Project name is too long.");
  return name;
}

/** True if `child` is `parent` or inside it (both absolute, already resolved). */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

/**
 * Turns a validated relative path into an absolute path inside `root`, refusing anything that — after following
 * symlinks of the existing part — would end up outside the project.
 */
export async function resolveInside(
  root: string,
  relPath: string,
): Promise<string> {
  const realRoot = await realpath(root);
  const target = join(realRoot, ...relPath.split("/"));
  // Walk up to the deepest existing ancestor and resolve its symlinks.
  let existing = target;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await realpath(existing);
      const resolved = join(real, ...missing);
      if (!isInside(realRoot, resolved)) {
        throw new ApiError(
          400,
          "invalid_path",
          "The path leads outside the project.",
        );
      }
      return resolved;
    } catch (err) {
      // ENOTDIR: an ancestor is a file ("main.tex/x.tex"); callers report that as a conflict.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      const parent = join(existing, "..");
      if (parent === existing) throw err;
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}
