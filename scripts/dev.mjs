// Starts the server (with file watching) and the Vite dev server together, on every OS.
// Usage: npm run dev   → open http://localhost:5173
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const children = [
  spawn(process.execPath, ["--watch", "apps/server/src/index.ts", "--dev"], { stdio: "inherit" }),
  // npm is a .cmd script on Windows, which Node only runs through a shell.
  spawn(isWindows ? "npm.cmd" : "npm", ["run", "dev", "--workspace", "@texcollab/web"], {
    stdio: "inherit",
    shell: isWindows,
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => stop(code ?? 0));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
