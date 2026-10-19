import { execFile } from "node:child_process";
import { posix } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Official TeX Live image, full scheme, pinned by digest (DECISIONS.md, L4). */
export const DEFAULT_DOCKER_IMAGE =
  "texlive/texlive:latest-full@sha256:e8148b126545105c4aeeaa212f8a7bd02d05b500351372881055e1e59ae67d33";

export interface DockerInfo {
  available: boolean;
  version: string | null;
  image: string;
  imagePresent: boolean;
  pulling: boolean;
  pullError: string | null;
  problem: string | null;
}

export interface DockerRunOptions {
  name: string;
  image: string;
  /** Project folder on the host (mounted read-only at /project). */
  projectDir: string;
  /** Output folder on the host (mounted at /out). */
  outDir: string;
  /** Main file's folder relative to the project ("" for the root). */
  mainDir: string;
  /** Arguments for latexmk inside the container. */
  latexmkArgs: string[];
  /** "uid:gid" to run as; the files written to /out then belong to the user. */
  user: string;
}

/**
 * `docker run` arguments for a sandboxed compile: no network, read-only root, no capabilities,
 * no new privileges, CPU/memory/pids limits, the project mounted read-only, only the output folder writable.
 */
export function dockerRunArgs(o: DockerRunOptions): string[] {
  return [
    "run",
    "--rm",
    "--name",
    o.name,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=512m",
    "--memory",
    "2g",
    "--memory-swap",
    "2g",
    "--cpus",
    "2",
    "--pids-limit",
    "512",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--user",
    o.user,
    "--mount",
    `type=bind,source=${o.projectDir},target=/project,readonly`,
    "--mount",
    `type=bind,source=${o.outDir},target=/out`,
    "--workdir",
    o.mainDir ? posix.join("/project", o.mainDir) : "/project",
    "--env",
    "HOME=/tmp",
    "--env",
    "TEXMFVAR=/tmp/texmf-var",
    "--env",
    "max_print_line=10000",
    "--env",
    "error_line=254",
    "--env",
    "half_error_line=238",
    "--env",
    "openout_any=p",
    o.image,
    "latexmk",
    ...o.latexmkArgs,
  ];
}

/** The `docker` command line tool: detection, image download, container removal. */
export class DockerTex {
  readonly image: string;
  private readonly command: string[] | null;
  private pulling = false;
  private pullError: string | null = null;

  constructor(command: string[] | null, image: string) {
    this.command = command;
    this.image = image;
  }

  get cli(): string[] | null {
    return this.command;
  }

  async info(): Promise<DockerInfo> {
    const base = {
      image: this.image,
      pulling: this.pulling,
      pullError: this.pullError,
    };
    if (!this.command) {
      return {
        ...base,
        available: false,
        version: null,
        imagePresent: false,
        problem: "Docker was not found on PATH.",
      };
    }
    let version: string;
    try {
      version = (
        await this.exec(["version", "--format", "{{.Server.Version}}"], 15_000)
      ).trim();
    } catch {
      return {
        ...base,
        available: false,
        version: null,
        imagePresent: false,
        problem:
          "Docker is installed but not running. Start Docker Desktop (or the Docker service).",
      };
    }
    const imagePresent = await this.exec(
      ["image", "inspect", this.image],
      15_000,
    ).then(
      () => true,
      () => false,
    );
    return { ...base, available: true, version, imagePresent, problem: null };
  }

  /** Downloads the TeX image in the background (it is large); `info()` reports progress. */
  pull(): void {
    if (this.pulling || !this.command) return;
    this.pulling = true;
    this.pullError = null;
    this.exec(["pull", this.image], 60 * 60_000).then(
      () => {
        this.pulling = false;
      },
      (err: unknown) => {
        this.pulling = false;
        this.pullError =
          (err as Error).message.split("\n")[0] ?? "Download failed.";
      },
    );
  }

  /** Removes a container (used when a compile times out: killing the CLI does not stop the container). */
  async remove(name: string): Promise<void> {
    await this.exec(["rm", "-f", name], 30_000).catch(() => undefined);
  }

  private async exec(args: string[], timeout: number): Promise<string> {
    if (!this.command?.[0]) throw new Error("docker not found");
    const { stdout } = await run(
      this.command[0],
      [...this.command.slice(1), ...args],
      {
        timeout,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return stdout;
  }
}

/** "uid:gid" of the current user where the OS has them, else the conventional 1000:1000. */
export function containerUser(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid !== undefined && gid !== undefined
    ? `${String(uid)}:${String(gid)}`
    : "1000:1000";
}
