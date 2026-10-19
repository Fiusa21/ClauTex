// A stand-in for the docker CLI in tests. Usage: node fake-docker.mjs <stateDir> <docker args…>
//   version …            prints a version
//   image inspect <img>  succeeds once the image was "pulled"
//   pull <img>           marks the image as present
//   rm -f <name>         records the removal
//   run …                records the arguments, maps the bind mounts to host folders and runs fake-latexmk
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [stateDir, command, ...rest] = process.argv.slice(2);
mkdirSync(stateDir, { recursive: true });
const marker = join(stateDir, "image-present");

switch (command) {
  case "version":
    console.log("27.0.0-fake");
    break;
  case "image":
    process.exit(existsSync(marker) ? 0 : 1);
    break;
  case "pull":
    writeFileSync(marker, "");
    break;
  case "rm":
    appendFileSync(join(stateDir, "removed.txt"), `${rest.at(-1)}\n`);
    break;
  case "run": {
    writeFileSync(join(stateDir, "run-args.json"), JSON.stringify(rest));
    const mounts = [];
    let workdir = "/";
    let i = 0;
    while (i < rest.length && rest[i]?.startsWith("--")) {
      const flag = rest[i];
      const value = rest[i + 1];
      if (flag === "--rm" || flag === "--read-only") {
        i += 1;
        continue;
      }
      if (flag === "--mount") {
        const fields = Object.fromEntries(
          value.split(",").map((f) => f.split("=")),
        );
        mounts.push({ source: fields.source, target: fields.target });
      }
      if (flag === "--workdir") workdir = value;
      i += 2;
    }
    const [, latexmk, ...args] = rest.slice(i); // image, "latexmk", args
    if (latexmk !== "latexmk") process.exit(2);
    const toHost = (p) => {
      for (const m of mounts)
        if (p === m.target || p.startsWith(`${m.target}/`))
          return m.source + p.slice(m.target.length);
      return p;
    };
    const mapped = args.map((a) =>
      a.startsWith("-outdir=") ? `-outdir=${toHost(a.slice(8))}` : a,
    );
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "fake-latexmk.mjs"), ...mapped],
      {
        cwd: toHost(workdir),
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => process.exit(code ?? 1));
    break;
  }
  default:
    process.exit(1);
}
