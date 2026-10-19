import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { normalizePath, normalizeProjectName } from "./paths.ts";
import { ApiError } from "./problem.ts";
import { STARTER_MAIN, starterMainTex } from "./starter.ts";

export type Compiler = "pdflatex" | "xelatex" | "lualatex";
const COMPILERS = new Set<string>(["pdflatex", "xelatex", "lualatex"]);

export const CONFIG_FILE = ".texcollab.json";
export const TRASH_DIR = ".trash";

/** Ids of folders opened from outside the workspace. `:` cannot occur in project names, so ids never clash. */
export const EXTERNAL_PREFIX = "ext:";

export interface ProjectSettings {
  mainFile: string | null;
  compiler: Compiler;
}

export interface ProjectInfo extends ProjectSettings {
  /** Folder name for workspace projects, `ext:<hash>` for opened folders. Used in URLs. */
  id: string;
  /** Display name (the folder name). */
  name: string;
  /** True for folders opened from outside the workspace. */
  external: boolean;
  /** Absolute path of opened folders; null for workspace projects. */
  path: string | null;
  updatedAt: string;
}

export interface TrashEntry {
  entry: string;
  name: string;
  deletedAt: string;
}

/** Where the absolute paths of opened folders come from (the app settings). */
export interface FolderRegistry {
  folders: () => Promise<string[]>;
}

const notFound = () =>
  new ApiError(404, "project_not_found", "Project not found.");

const notForFolders = (what: string) =>
  new ApiError(
    400,
    "not_supported_for_folders",
    `${what} is not possible for opened folders. Use your file manager, or remove the folder from the list.`,
  );

/** Stable id for an opened folder, from its real path. */
export function externalId(realPath: string): string {
  return `${EXTERNAL_PREFIX}${createHash("sha256").update(realPath).digest("hex").slice(0, 16)}`;
}

export const isExternalId = (id: string) => id.startsWith(EXTERNAL_PREFIX);

/**
 * Projects are the non-hidden subfolders of the workspace folder (SPEC §3), plus folders opened from elsewhere
 * (L4, "open folder"), which are addressed by an `ext:` id.
 */
export class Workspace {
  private rootDir: string;
  private readonly registry: FolderRegistry;

  constructor(
    root: string,
    registry: FolderRegistry = { folders: () => Promise.resolve([]) },
  ) {
    this.rootDir = root;
    this.registry = registry;
  }

  get root(): string {
    return this.rootDir;
  }

  /** Switches to another workspace folder (settings), creating it if needed. */
  async setRoot(root: string): Promise<void> {
    await mkdir(root, { recursive: true });
    this.rootDir = root;
  }

  /** Absolute folder of an existing project. */
  async projectDir(id: string): Promise<string> {
    if (isExternalId(id)) return this.externalDir(id);
    const name = normalizeProjectName(id);
    const dir = join(this.root, name);
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) throw notFound();
    return dir;
  }

  /** A label safe to use as a folder name (for the file trash). */
  async label(id: string): Promise<string> {
    return isExternalId(id)
      ? basename(await this.projectDir(id))
      : normalizeProjectName(id);
  }

  async list(): Promise<ProjectInfo[]> {
    const entries = await readdir(this.root, { withFileTypes: true });
    const projects: ProjectInfo[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      try {
        projects.push(await this.info(entry.name));
      } catch {
        // not a usable project folder (broken symlink, invalid name, …)
      }
    }
    for (const folder of await this.registry.folders()) {
      try {
        projects.push(await this.info(externalId(await realpath(folder))));
      } catch {
        // the folder is gone; it stays in the settings until the user removes it
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async info(id: string): Promise<ProjectInfo> {
    const dir = await this.projectDir(id);
    const external = isExternalId(id);
    return {
      id: external ? id : normalizeProjectName(id),
      name: external ? basename(dir) : normalizeProjectName(id),
      external,
      path: external ? dir : null,
      ...(await this.settings(dir)),
      updatedAt: (await latestMtime(dir)).toISOString(),
    };
  }

  async create(rawName: string): Promise<ProjectInfo> {
    const name = normalizeProjectName(rawName);
    const dir = join(this.root, name);
    await mkdirNew(dir, name);
    await writeFile(join(dir, STARTER_MAIN), starterMainTex(name), {
      flag: "wx",
    });
    return this.info(name);
  }

  async rename(id: string, rawNewName: string): Promise<string> {
    if (isExternalId(id)) throw notForFolders("Renaming");
    const from = await this.projectDir(id);
    const newName = normalizeProjectName(rawNewName);
    const to = join(this.root, newName);
    // A case-only rename ("thesis" → "Thesis") finds the same folder on case-insensitive file systems.
    if (await exists(to)) {
      if (!(await sameEntry(from, to))) {
        throw new ApiError(
          409,
          "project_exists",
          `A project named "${newName}" already exists.`,
        );
      }
    }
    await rename(from, to);
    return newName;
  }

  /** Copies a project (or an opened folder) into the workspace. */
  async duplicate(id: string, rawNewName?: string): Promise<ProjectInfo> {
    const from = await this.projectDir(id);
    const name =
      rawNewName !== undefined
        ? normalizeProjectName(rawNewName)
        : await this.freeName(`Copy of ${basename(from)}`);
    const to = join(this.root, name);
    // mkdir reserves the name atomically; the entries are then copied into it one by one
    // (newer Node versions refuse to `cp` a folder onto an existing, even empty, folder).
    await mkdirNew(to, name);
    try {
      for (const entry of await readdir(from)) {
        await cp(join(from, entry), join(to, entry), {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
        });
      }
    } catch (err) {
      await rm(to, { recursive: true, force: true });
      throw err;
    }
    return this.info(name);
  }

  /** Moves a project to `<workspace>/.trash/<name>~<timestamp>` (restorable). */
  async trash(id: string): Promise<void> {
    if (isExternalId(id)) throw notForFolders("Deleting");
    const dir = await this.projectDir(id);
    await mkdir(join(this.root, TRASH_DIR), { recursive: true });
    await rename(
      dir,
      join(this.root, TRASH_DIR, `${normalizeProjectName(id)}~${timestamp()}`),
    );
  }

  private async externalDir(id: string): Promise<string> {
    for (const folder of await this.registry.folders()) {
      const real = await realpath(folder).catch(() => null);
      if (
        real &&
        externalId(real) === id &&
        (await stat(real).catch(() => null))?.isDirectory()
      ) {
        return real;
      }
    }
    throw notFound();
  }

  async listTrash(): Promise<TrashEntry[]> {
    const dir = join(this.root, TRASH_DIR);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => parseTrashEntry(e.name))
      .filter((e): e is TrashEntry => e !== null)
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  async restore(rawEntry: string): Promise<ProjectInfo> {
    const entry = parseTrashEntry(normalizeProjectName(rawEntry));
    const from = entry ? join(this.root, TRASH_DIR, entry.entry) : null;
    if (!entry || !from || !(await exists(from))) {
      throw new ApiError(
        404,
        "trash_entry_not_found",
        "This item is no longer in the trash.",
      );
    }
    const to = join(this.root, entry.name);
    if (await exists(to)) {
      throw new ApiError(
        409,
        "project_exists",
        `A project named "${entry.name}" already exists. Rename it first.`,
      );
    }
    await rename(from, to);
    return this.info(entry.name);
  }

  /** Main file and compiler from `.texcollab.json`, with defaults (SPEC §3). */
  async settings(dir: string): Promise<ProjectSettings> {
    let stored: { mainFile?: string; compiler?: Compiler } = {};
    try {
      const raw = JSON.parse(
        await readFile(join(dir, CONFIG_FILE), "utf8"),
      ) as Record<string, unknown>;
      stored = {
        ...(typeof raw.mainFile === "string" ? { mainFile: raw.mainFile } : {}),
        ...(typeof raw.compiler === "string" && COMPILERS.has(raw.compiler)
          ? { compiler: raw.compiler as Compiler }
          : {}),
      };
    } catch {
      // missing or invalid: defaults
    }
    return {
      mainFile: await this.effectiveMainFile(dir, stored.mainFile),
      compiler: stored.compiler ?? "pdflatex",
    };
  }

  async saveSettings(
    dir: string,
    changes: Partial<{ mainFile: string; compiler: Compiler }>,
  ): Promise<void> {
    const current = await this.settings(dir);
    const next = {
      mainFile: changes.mainFile ?? current.mainFile,
      compiler: changes.compiler ?? current.compiler,
    };
    await writeFile(
      join(dir, CONFIG_FILE),
      `${JSON.stringify(next, null, 2)}\n`,
    );
  }

  private async effectiveMainFile(
    dir: string,
    configured: string | undefined,
  ): Promise<string | null> {
    if (configured !== undefined) {
      try {
        const path = normalizePath(configured);
        if ((await stat(join(dir, ...path.split("/")))).isFile()) return path;
      } catch {
        // invalid or missing: fall back
      }
    }
    if (await isFile(join(dir, STARTER_MAIN))) return STARTER_MAIN;
    const texFiles = (await readdir(dir, { withFileTypes: true }))
      .filter(
        (e) =>
          e.isFile() &&
          e.name.toLowerCase().endsWith(".tex") &&
          !e.name.startsWith("."),
      )
      .map((e) => e.name)
      .sort();
    return texFiles[0] ?? null;
  }

  private async freeName(base: string): Promise<string> {
    const trimmed = base.slice(0, 110);
    for (let i = 1; i < 1000; i++) {
      const candidate = i === 1 ? trimmed : `${trimmed} (${String(i)})`;
      if (!(await exists(join(this.root, candidate))))
        return normalizeProjectName(candidate);
    }
    throw new ApiError(409, "project_exists", "Could not find a free name.");
  }
}

function timestamp(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function parseTrashEntry(entry: string): TrashEntry | null {
  const match = /^(.+)~(\d{8}T\d{6}Z)$/.exec(entry);
  if (!match?.[1] || !match[2]) return null;
  const t = match[2];
  const deletedAt = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`;
  return { entry, name: match[1], deletedAt };
}

async function mkdirNew(dir: string, name: string): Promise<void> {
  try {
    await mkdir(dir); // not recursive: fails if it exists (also case-insensitively)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ApiError(
        409,
        "project_exists",
        `A project named "${name}" already exists.`,
      );
    }
    throw err;
  }
}

/** True if both paths are the same file system entry (e.g. differing only in case on macOS/Windows). */
export async function sameEntry(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([
    stat(a).catch(() => null),
    stat(b).catch(() => null),
  ]);
  return sa !== null && sb !== null && sa.dev === sb.dev && sa.ino === sb.ino;
}

export async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

/** Newest modification time in a project (bounded walk; hidden entries skipped). */
async function latestMtime(
  dir: string,
  budget = { left: 2000 },
): Promise<Date> {
  let latest = (await stat(dir)).mtime;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (budget.left-- <= 0) break;
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    const time = entry.isDirectory()
      ? await latestMtime(path, budget)
      : (await stat(path).catch(() => null))?.mtime;
    if (time && time > latest) latest = time;
  }
  return latest;
}
