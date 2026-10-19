import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "./problem.ts";

/** App-wide settings, stored as JSON in the OS config folder. */
export interface AppSettings {
  /** Hard limit per compile; the whole process tree is killed after it. */
  compileTimeoutSeconds: number;
}

export const DEFAULT_SETTINGS: AppSettings = { compileTimeoutSeconds: 120 };
const MIN_TIMEOUT = 10;
const MAX_TIMEOUT = 1800;

export class SettingsStore {
  private readonly file: string;
  private cached: AppSettings | null = null;

  constructor(configDir: string) {
    this.file = join(configDir, "settings.json");
  }

  async get(): Promise<AppSettings> {
    if (this.cached) return this.cached;
    let stored: Partial<AppSettings> = {};
    try {
      stored = JSON.parse(
        await readFile(this.file, "utf8"),
      ) as Partial<AppSettings>;
    } catch {
      // missing or invalid: defaults
    }
    const timeout = stored.compileTimeoutSeconds;
    this.cached = {
      compileTimeoutSeconds:
        typeof timeout === "number" &&
        Number.isInteger(timeout) &&
        timeout >= MIN_TIMEOUT &&
        timeout <= MAX_TIMEOUT
          ? timeout
          : DEFAULT_SETTINGS.compileTimeoutSeconds,
    };
    return this.cached;
  }

  async update(changes: unknown): Promise<AppSettings> {
    const body =
      changes !== null && typeof changes === "object"
        ? (changes as Record<string, unknown>)
        : {};
    const next = { ...(await this.get()) };
    if (body.compileTimeoutSeconds !== undefined) {
      const t = body.compileTimeoutSeconds;
      if (
        typeof t !== "number" ||
        !Number.isInteger(t) ||
        t < MIN_TIMEOUT ||
        t > MAX_TIMEOUT
      ) {
        throw new ApiError(
          400,
          "validation_failed",
          `compileTimeoutSeconds must be a whole number from ${String(MIN_TIMEOUT)} to ${String(MAX_TIMEOUT)}.`,
        );
      }
      next.compileTimeoutSeconds = t;
    }
    await mkdir(join(this.file, ".."), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temp, this.file);
    this.cached = next;
    return next;
  }
}
