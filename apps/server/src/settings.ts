import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ApiError } from "./problem.ts";

export type CompileMode = "local" | "docker";

/** App-wide settings, stored as JSON in the OS config folder. */
export interface AppSettings {
  /** Hard limit per compile; the whole process tree (or container) is killed after it. */
  compileTimeoutSeconds: number;
  compileMode: CompileMode;
  /** Workspace folder chosen in the UI; null = default (or the one given on the command line). */
  workspace: string | null;
  /** Folders opened from outside the workspace, most recent first (absolute real paths). */
  recentFolders: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  compileTimeoutSeconds: 120,
  compileMode: "local",
  workspace: null,
  recentFolders: [],
};
const MIN_TIMEOUT = 10;
const MAX_TIMEOUT = 1800;
export const MAX_RECENT_FOLDERS = 20;

const validTimeout = (t: unknown): t is number =>
  typeof t === "number" &&
  Number.isInteger(t) &&
  t >= MIN_TIMEOUT &&
  t <= MAX_TIMEOUT;

export class SettingsStore {
  private readonly file: string;
  private cached: AppSettings | null = null;

  constructor(configDir: string) {
    this.file = join(configDir, "settings.json");
  }

  async get(): Promise<AppSettings> {
    if (this.cached) return this.cached;
    let stored: Record<string, unknown> = {};
    try {
      stored = JSON.parse(await readFile(this.file, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      // missing or invalid: defaults
    }
    this.cached = {
      compileTimeoutSeconds: validTimeout(stored.compileTimeoutSeconds)
        ? stored.compileTimeoutSeconds
        : DEFAULT_SETTINGS.compileTimeoutSeconds,
      compileMode: stored.compileMode === "docker" ? "docker" : "local",
      workspace:
        typeof stored.workspace === "string" && isAbsolute(stored.workspace)
          ? stored.workspace
          : null,
      recentFolders: Array.isArray(stored.recentFolders)
        ? stored.recentFolders
            .filter((f): f is string => typeof f === "string" && isAbsolute(f))
            .slice(0, MAX_RECENT_FOLDERS)
        : [],
    };
    return this.cached;
  }

  /** Validates and stores user-editable settings (timeout, compile mode). */
  async update(changes: unknown): Promise<AppSettings> {
    const body =
      changes !== null && typeof changes === "object"
        ? (changes as Record<string, unknown>)
        : {};
    const next = { ...(await this.get()) };
    if (body.compileTimeoutSeconds !== undefined) {
      if (!validTimeout(body.compileTimeoutSeconds)) {
        throw new ApiError(
          400,
          "validation_failed",
          `compileTimeoutSeconds must be a whole number from ${String(MIN_TIMEOUT)} to ${String(MAX_TIMEOUT)}.`,
        );
      }
      next.compileTimeoutSeconds = body.compileTimeoutSeconds;
    }
    if (body.compileMode !== undefined) {
      if (body.compileMode !== "local" && body.compileMode !== "docker") {
        throw new ApiError(
          400,
          "validation_failed",
          'compileMode must be "local" or "docker".',
        );
      }
      next.compileMode = body.compileMode;
    }
    return this.save(next);
  }

  async setWorkspace(path: string | null): Promise<AppSettings> {
    return this.save({ ...(await this.get()), workspace: path });
  }

  async addRecentFolder(path: string): Promise<AppSettings> {
    const current = await this.get();
    return this.save({
      ...current,
      recentFolders: [
        path,
        ...current.recentFolders.filter((f) => f !== path),
      ].slice(0, MAX_RECENT_FOLDERS),
    });
  }

  async removeRecentFolder(path: string): Promise<AppSettings> {
    const current = await this.get();
    return this.save({
      ...current,
      recentFolders: current.recentFolders.filter((f) => f !== path),
    });
  }

  private async save(next: AppSettings): Promise<AppSettings> {
    await mkdir(join(this.file, ".."), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temp, this.file);
    this.cached = next;
    return next;
  }
}
