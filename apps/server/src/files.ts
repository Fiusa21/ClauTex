import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isInside, normalizePath, resolveInside } from "./paths.ts";
import { ApiError } from "./problem.ts";
import { MAX_UPLOAD_BYTES, isTextPath } from "./textFiles.ts";
import { exists, sameEntry, TRASH_DIR, type Workspace } from "./workspace.ts";

export interface FileInfo {
  path: string;
  kind: "folder" | "file";
  /** Editable as text (by extension). */
  text: boolean;
  size: number | null;
  mtime: string;
}

const MAX_LISTED = 10_000;

/**
 * Project-relative path for the file API. Hidden segments are refused: they are not listed, and writing to e.g.
 * `.git/hooks` or `.texcollab.json` must not be possible through the API.
 */
export function apiPath(raw: unknown): string {
  const path = normalizePath(raw);
  if (path.split("/").some((segment) => segment.startsWith("."))) {
    throw new ApiError(
      400,
      "invalid_path",
      "Hidden files and folders (starting with a dot) cannot be used.",
    );
  }
  return path;
}

const pathExists = (path: string) =>
  new ApiError(409, "path_exists", `"${path}" already exists.`);
const fileNotFound = () =>
  new ApiError(404, "file_not_found", "File not found.");

/** File operations inside one project folder. All client paths are validated and resolved inside the project. */
export class ProjectFiles {
  private readonly workspace: Workspace;
  readonly dir: string;

  constructor(workspace: Workspace, dir: string) {
    this.workspace = workspace;
    this.dir = dir;
  }

  /** Flat list sorted by path. Hidden entries and symlinks leading outside the project are skipped. */
  async list(): Promise<FileInfo[]> {
    const root = await realpath(this.dir);
    const out: FileInfo[] = [];
    const walk = async (abs: string, rel: string): Promise<void> => {
      const entries = await readdir(abs, { withFileTypes: true });
      for (const entry of entries) {
        if (out.length >= MAX_LISTED) return;
        if (entry.name.startsWith(".")) continue;
        const childAbs = join(abs, entry.name);
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        let real = childAbs;
        if (entry.isSymbolicLink()) {
          real = await realpath(childAbs).catch(() => "");
          if (!real || !isInside(root, real)) continue;
        }
        const info = await stat(real).catch(() => null);
        if (!info) continue;
        if (info.isDirectory()) {
          out.push({
            path: childRel,
            kind: "folder",
            text: false,
            size: null,
            mtime: info.mtime.toISOString(),
          });
          if (!entry.isSymbolicLink()) await walk(childAbs, childRel); // never follow directory links (cycles)
        } else if (info.isFile()) {
          out.push({
            path: childRel,
            kind: "file",
            text: isTextPath(childRel),
            size: info.size,
            mtime: info.mtime.toISOString(),
          });
        }
      }
    };
    await walk(root, "");
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /** Absolute path of an existing file (not a folder). */
  async existingFile(
    rawPath: unknown,
  ): Promise<{ path: string; abs: string; size: number; mtime: Date }> {
    const path = apiPath(rawPath);
    const abs = await resolveInside(this.dir, path);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) throw fileNotFound();
    return { path, abs, size: info.size, mtime: info.mtime };
  }

  async create(rawPath: unknown, kind: unknown): Promise<FileInfo> {
    const path = apiPath(rawPath);
    if (kind !== "file" && kind !== "folder") {
      throw new ApiError(
        400,
        "validation_failed",
        'kind must be "file" or "folder".',
      );
    }
    const abs = await this.prepareNew(path);
    try {
      if (kind === "folder") await mkdir(abs);
      else await writeFile(abs, "", { flag: "wx" }); // exclusive: also catches case-insensitive clashes
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST")
        throw pathExists(path);
      throw err;
    }
    return this.describe(path);
  }

  /**
   * Stores an upload (max 50 MB). Written to a temporary file first and renamed into place, so a failed upload
   * never leaves a half-written file. An existing file is only replaced when `replace` is set.
   */
  async upload(
    rawPath: unknown,
    content: Readable,
    replace: boolean,
  ): Promise<FileInfo> {
    const path = apiPath(rawPath);
    const abs = await this.prepareNew(path, { allowExisting: replace });
    const temp = join(
      dirname(abs),
      `.texcollab-upload-${randomBytes(6).toString("hex")}`,
    );
    try {
      await pipeline(content, createWriteStream(temp, { flags: "wx" }));
      if ((content as Readable & { truncated?: boolean }).truncated) {
        throw new ApiError(
          413,
          "file_too_large",
          `Files can be at most ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
        );
      }
      if (!replace && (await exists(abs))) throw pathExists(path); // created meanwhile
      await rename(temp, abs);
    } finally {
      await rm(temp, { force: true });
    }
    return this.describe(path);
  }

  /** Renames or moves a file or folder. Returns the new path. */
  async move(rawFrom: unknown, rawTo: unknown): Promise<FileInfo> {
    const from = apiPath(rawFrom);
    const to = apiPath(rawTo);
    const fromAbs = await resolveInside(this.dir, from);
    const fromInfo = await lstat(fromAbs).catch(() => null);
    if (!fromInfo) throw fileNotFound();
    if (to === from) return this.describe(from);
    if (to.startsWith(`${from}/`)) {
      throw new ApiError(
        400,
        "invalid_move",
        "A folder cannot be moved into itself.",
      );
    }
    await this.ensureParents(to);
    const toAbs = await this.resolveTarget(to);
    if ((await exists(toAbs)) && !(await sameEntry(fromAbs, toAbs)))
      throw pathExists(to);

    const settings = await this.workspace.settings(this.dir);
    await rename(fromAbs, toAbs);
    // The main file follows renames and moves (SPEC §4).
    const main = settings.mainFile;
    if (main !== null && (main === from || main.startsWith(`${from}/`))) {
      await this.workspace.saveSettings(this.dir, {
        mainFile: to + main.slice(from.length),
      });
    }
    return this.describe(to);
  }

  /**
   * Deletes a file or folder by moving it to `<workspace>/.trash/<project>/<timestamp>/<path>`, so mistakes can be
   * recovered with a file manager. The main file (or a folder containing it) cannot be deleted.
   */
  async remove(rawPath: unknown, projectName: string): Promise<void> {
    const path = apiPath(rawPath);
    const abs = await resolveInside(this.dir, path);
    if (!(await lstat(abs).catch(() => null))) throw fileNotFound();
    const main = (await this.workspace.settings(this.dir)).mainFile;
    if (main !== null && (main === path || main.startsWith(`${path}/`))) {
      throw new ApiError(
        409,
        "main_file_protected",
        "This is (or contains) the main file. Choose another main file first.",
      );
    }
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const target = join(
      this.workspace.root,
      TRASH_DIR,
      projectName,
      stamp,
      ...path.split("/"),
    );
    await mkdir(dirname(target), { recursive: true });
    await rename(abs, target);
  }

  /**
   * Absolute path for a rename target: the parent is resolved (symlinks, containment), the final name is kept exactly
   * as given — resolving it would return the existing file's case and turn "intro" → "Intro" into a no-op.
   */
  private async resolveTarget(path: string): Promise<string> {
    const slash = path.lastIndexOf("/");
    const parent = slash < 0 ? "" : path.slice(0, slash);
    const parentAbs = parent
      ? await resolveInside(this.dir, parent)
      : await realpath(this.dir);
    return join(parentAbs, path.slice(slash + 1));
  }

  async describe(path: string): Promise<FileInfo> {
    const abs = await resolveInside(this.dir, path);
    const info = await stat(abs);
    return info.isDirectory()
      ? {
          path,
          kind: "folder",
          text: false,
          size: null,
          mtime: info.mtime.toISOString(),
        }
      : {
          path,
          kind: "file",
          text: isTextPath(path),
          size: info.size,
          mtime: info.mtime.toISOString(),
        };
  }

  /** Resolves a path for a new entry, creating missing parent folders; rejects existing paths unless allowed. */
  private async prepareNew(
    path: string,
    opts: { allowExisting?: boolean } = {},
  ): Promise<string> {
    const abs = await resolveInside(this.dir, path);
    const existing = await lstat(abs).catch(() => null);
    if (existing && !(opts.allowExisting && existing.isFile()))
      throw pathExists(path);
    await this.ensureParents(path);
    return abs;
  }

  private async ensureParents(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      const abs = await resolveInside(this.dir, parent);
      const info = await stat(abs).catch(() => null);
      if (!info) await mkdir(abs);
      else if (!info.isDirectory()) {
        throw new ApiError(
          409,
          "path_conflict",
          `"${parent}" is a file, not a folder.`,
        );
      }
    }
  }
}
