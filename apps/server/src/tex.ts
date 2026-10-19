import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface TexInfo {
  available: boolean;
  /** First line of `latexmk -v`, e.g. "Latexmk, John Collins, … Version 4.88". */
  version: string | null;
  engines: { pdflatex: boolean; xelatex: boolean; lualatex: boolean };
  /** Why compiling is not possible, for the setup panel. */
  problem: string | null;
}

/**
 * Finds an executable on PATH without a shell. On Windows only `.exe` files are accepted: Node cannot run `.bat`/`.cmd`
 * without a shell, and TeX Live and MiKTeX both ship `latexmk.exe`.
 */
export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const candidates = platform === "win32" ? [`${name}.exe`] : [name];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const path = join(dir, candidate);
      try {
        if (!statSync(path).isFile()) continue;
        if (platform !== "win32") accessSync(path, constants.X_OK);
        return path;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/** Checks whether latexmk works and which engines are installed. */
export async function detectTex(
  latexmkCommand: string[] | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TexInfo> {
  const engines = {
    pdflatex: findExecutable("pdflatex", env) !== null,
    xelatex: findExecutable("xelatex", env) !== null,
    lualatex: findExecutable("lualatex", env) !== null,
  };
  const command =
    latexmkCommand ??
    (findExecutable("latexmk", env)
      ? [findExecutable("latexmk", env) as string]
      : null);
  if (!command?.[0]) {
    return {
      available: false,
      version: null,
      engines,
      problem: "latexmk was not found on PATH.",
    };
  }
  try {
    const { stdout } = await run(command[0], [...command.slice(1), "-v"], {
      timeout: 15_000,
      windowsHide: true,
      env,
    });
    const version =
      stdout
        .split(/\r?\n/)
        .find((line) => line.trim().length > 0)
        ?.trim() ?? "latexmk";
    return { available: true, version, engines, problem: null };
  } catch (err) {
    const message = (err as Error).message;
    return {
      available: false,
      version: null,
      engines,
      // latexmk is a Perl script; on Windows it needs the Perl that TeX Live ships (MiKTeX installs it on demand).
      problem: `latexmk was found but did not run: ${message.split("\n")[0] ?? message}`,
    };
  }
}
