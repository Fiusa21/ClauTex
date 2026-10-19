import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { apiPath } from "../files.ts";
import { resolveInside } from "../paths.ts";
import { ApiError } from "../problem.ts";
import type { SettingsStore } from "../settings.ts";
import type { Compiler as Engine, Workspace } from "../workspace.ts";
import { LogParser, type Issue } from "./logParser.ts";
import { runWithTimeout } from "./processTree.ts";

export type BuildStatus = "success" | "failure" | "timeout" | "error";

export interface Build {
  status: BuildStatus;
  errors: Issue[];
  logExcerpt: string;
  durationMs: number;
  createdAt: string;
  /** URL of the last successful PDF (may be from an earlier build), or null. */
  pdfUrl: string | null;
  /** True when this build produced the PDF behind `pdfUrl`. */
  pdfIsFresh: boolean;
}

const LOG_EXCERPT_CHARS = 4000;
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const LAST_GOOD_PDF = "latest.pdf";

/** Runs latexmk on local projects (SPEC §6). One compile per project at a time. */
export class LocalCompiler {
  private readonly running = new Set<string>();
  private readonly kills = new Set<() => void>();

  private readonly workspace: Workspace;
  private readonly settings: SettingsStore;
  private readonly cacheDir: string;
  private readonly latexmk: () => string[] | null;

  constructor(opts: {
    workspace: Workspace;
    settings: SettingsStore;
    cacheDir: string;
    /** The latexmk command (path + leading args), or null when TeX is not installed. */
    latexmk: () => string[] | null;
  }) {
    this.workspace = opts.workspace;
    this.settings = opts.settings;
    this.cacheDir = opts.cacheDir;
    this.latexmk = opts.latexmk;
  }

  async compile(projectName: string): Promise<Build> {
    const command = this.latexmk();
    if (!command?.[0]) {
      throw new ApiError(
        503,
        "tex_not_found",
        "No TeX installation was found. See the setup instructions.",
      );
    }
    const dir = await this.workspace.projectDir(projectName);
    const root = await realpath(dir);
    const { mainFile, compiler } = await this.workspace.settings(dir);
    if (!mainFile) {
      throw new ApiError(
        400,
        "main_file_not_found",
        "This project has no .tex file to compile.",
      );
    }
    const main = apiPath(mainFile);
    await resolveInside(dir, main); // never compile something outside the project

    if (this.running.has(root)) {
      throw new ApiError(
        409,
        "compile_in_progress",
        "This project is already being compiled.",
      );
    }
    this.running.add(root);
    try {
      return await this.run(projectName, root, main, compiler, command);
    } finally {
      this.running.delete(root);
    }
  }

  /** The last build of a project (shown when the project is opened), or null. */
  async lastBuild(projectName: string): Promise<Build | null> {
    const out = this.buildDir(
      await realpath(await this.workspace.projectDir(projectName)),
    );
    try {
      return JSON.parse(
        await readFile(join(out, "build.json"), "utf8"),
      ) as Build;
    } catch {
      return null;
    }
  }

  /** Absolute path of the last successful PDF or the last log, or null. */
  async output(
    projectName: string,
    kind: "pdf" | "log",
  ): Promise<string | null> {
    const out = this.buildDir(
      await realpath(await this.workspace.projectDir(projectName)),
    );
    const file = join(out, kind === "pdf" ? LAST_GOOD_PDF : "output.log");
    return (await stat(file).catch(() => null))?.isFile() ? file : null;
  }

  /** Ends running compiles (server shutdown). */
  stopAll(): void {
    for (const kill of this.kills) kill();
  }

  private async run(
    projectName: string,
    root: string,
    main: string,
    engine: Engine,
    command: string[],
  ): Promise<Build> {
    const out = this.buildDir(root);
    await mkdir(out, { recursive: true });
    // `\include{chapters/x}` writes chapters/x.aux into the output folder, which must already exist.
    await mirrorFolders(root, out);
    await rm(join(out, "output.pdf"), { force: true });

    const slash = main.lastIndexOf("/");
    const cwd =
      slash < 0 ? root : join(root, ...main.slice(0, slash).split("/"));
    const args = [
      ...command.slice(1),
      engineFlag(engine),
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-no-shell-escape",
      "-norc",
      `-outdir=${out}`,
      "-jobname=output",
      // "./name" so a file name can never be read as an option.
      `./${main.slice(slash + 1)}`,
    ];
    const { compileTimeoutSeconds } = await this.settings.get();
    const started = Date.now();
    const process_ = runWithTimeout(command[0] ?? "latexmk", args, {
      cwd,
      env: {
        ...process.env,
        // Unwrapped log lines make file/line parsing reliable.
        max_print_line: "10000",
        error_line: "254",
        half_error_line: "238",
        // TeX may only write files below the current folder (and the output folder).
        openout_any: "p",
      },
      timeoutMs: compileTimeoutSeconds * 1000,
    });
    this.kills.add(process_.kill);
    const result = await process_.done.finally(() =>
      this.kills.delete(process_.kill),
    );
    const durationMs = Date.now() - started;

    const log = await readCapped(join(out, "output.log"));
    const producedPdf =
      (await stat(join(out, "output.pdf")).catch(() => null))?.isFile() ??
      false;
    const status: BuildStatus = result.timedOut
      ? "timeout"
      : result.exitCode === null
        ? "error"
        : result.exitCode === 0 && producedPdf
          ? "success"
          : "failure";
    if (status === "success")
      await copyFile(join(out, "output.pdf"), join(out, LAST_GOOD_PDF));

    const errors = new LogParser({ mainFile: main, projectRoot: root }).parse(
      log,
    );
    const excerpt =
      status === "timeout"
        ? `The compile was stopped after ${String(compileTimeoutSeconds)} seconds. Check for infinite loops, or raise the timeout in the settings.`
        : tail(log || result.output);
    const hasPdf =
      (await stat(join(out, LAST_GOOD_PDF)).catch(() => null))?.isFile() ??
      false;
    const createdAt = new Date().toISOString();
    const build: Build = {
      status,
      errors,
      logExcerpt: excerpt,
      durationMs,
      createdAt,
      pdfUrl: hasPdf
        ? `/api/projects/${encodeURIComponent(projectName)}/output.pdf?v=${String(Date.parse(createdAt))}`
        : null,
      pdfIsFresh: status === "success",
    };
    await writeFile(join(out, "build.json"), JSON.stringify(build));
    return build;
  }

  /** `<cache>/builds/<hash of the project's real path>`; stable per folder, outside the project. */
  private buildDir(root: string): string {
    const key = createHash("sha256").update(root).digest("hex").slice(0, 24);
    return join(this.cacheDir, "builds", key);
  }
}

function engineFlag(engine: Engine): string {
  return engine === "pdflatex"
    ? "-pdf"
    : engine === "xelatex"
      ? "-xelatex"
      : "-lualatex";
}

async function mirrorFolders(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    await mkdir(join(to, entry.name), { recursive: true });
    await mirrorFolders(join(from, entry.name), join(to, entry.name));
  }
}

async function readCapped(path: string): Promise<string> {
  try {
    const bytes = await readFile(path);
    return bytes.subarray(0, MAX_LOG_BYTES).toString("utf8");
  } catch {
    return "";
  }
}

const tail = (text: string) =>
  text.length <= LOG_EXCERPT_CHARS ? text : text.slice(-LOG_EXCERPT_CHARS);
