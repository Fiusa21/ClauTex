import { spawn, spawnSync } from "node:child_process";

export interface RunResult {
  exitCode: number | null;
  timedOut: boolean;
  /** Combined stdout/stderr, truncated to the limit. */
  output: string;
}

const MAX_OUTPUT = 1024 * 1024;

/**
 * Runs a command without a shell and kills its whole process tree on timeout (CLAUDE.md rule 4): on POSIX the child
 * leads its own process group, on Windows `taskkill /T /F` ends the tree.
 */
export function runWithTimeout(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): { done: Promise<RunResult>; kill: () => void } {
  const isWindows = process.platform === "win32";
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    detached: !isWindows,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const collect = (chunk: Buffer) => {
    if (output.length < MAX_OUTPUT)
      output += chunk.toString("utf8").slice(0, MAX_OUTPUT - output.length);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  let timedOut = false;
  let finished = false;
  const killTree = () => {
    if (finished || child.pid === undefined) return;
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    killTree();
  }, opts.timeoutMs);

  const done = new Promise<RunResult>((resolve) => {
    child.on("error", (err) => {
      clearTimeout(timer);
      finished = true;
      resolve({
        exitCode: null,
        timedOut: false,
        output: `${output}\n${err.message}`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // latexmk may have left helpers running (e.g. a viewer it should not start); end the group.
      if (!isWindows && !timedOut) killTree();
      finished = true;
      resolve({ exitCode: code, timedOut, output });
    });
  });

  return {
    done,
    kill: () => {
      timedOut = true;
      killTree();
    },
  };
}
