import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCacheDir, defaultConfigDir } from "./osPaths.ts";
import { parseArgs } from "node:util";

export interface Config {
  port: number;
  /** Folder whose subfolders are the projects. */
  workspace: string;
  /** Built web app (apps/web/dist). */
  webDist: string;
  /** Extra origins allowed to call the API (the Vite dev server in `--dev`). */
  devOrigins: string[];
  /** App settings (OS config folder). */
  configDir: string;
  /** Build output (OS cache folder). */
  cacheDir: string;
  /** latexmk command override (path + leading args); null = find `latexmk` on PATH. */
  latexmk: string[] | null;
}

export const DEFAULT_PORT = 8765;
const DEV_SERVER_PORT = 5173;

const here = dirname(fileURLToPath(import.meta.url));

/** `<home>/Documents/TexCollab` where a Documents folder exists (DECISIONS.md, L1), else `<home>/TexCollab`. */
export function defaultWorkspace(
  home: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const documents = join(home, "Documents");
  return exists(documents)
    ? join(documents, "TexCollab")
    : join(home, "TexCollab");
}

/** Reads command-line flags first, then environment variables, then defaults. */
export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      workspace: { type: "string" },
      dev: { type: "boolean", default: false },
    },
    strict: true,
  });

  const rawPort = values.port ?? env.TEXCOLLAB_PORT ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }

  const workspace = resolve(
    values.workspace ?? env.TEXCOLLAB_WORKSPACE ?? defaultWorkspace(homedir()),
  );

  return {
    port,
    workspace,
    webDist: resolve(here, "..", "..", "web", "dist"),
    configDir: resolve(env.TEXCOLLAB_CONFIG_DIR ?? defaultConfigDir(env)),
    cacheDir: resolve(env.TEXCOLLAB_CACHE_DIR ?? defaultCacheDir(env)),
    latexmk: parseCommand(env.TEXCOLLAB_LATEXMK),
    devOrigins: values.dev
      ? [
          `http://localhost:${String(DEV_SERVER_PORT)}`,
          `http://127.0.0.1:${String(DEV_SERVER_PORT)}`,
        ]
      : [],
  };
}

/** `TEXCOLLAB_LATEXMK`: a path, or a JSON array such as `["node", "fake-latexmk.mjs"]` (used by tests). */
export function parseCommand(raw: string | undefined): string[] | null {
  if (!raw) return null;
  if (raw.trim().startsWith("[")) {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every((p) => typeof p === "string")
    ) {
      throw new Error(
        "TEXCOLLAB_LATEXMK must be a path or a JSON array of strings",
      );
    }
    return parsed;
  }
  return [raw];
}
