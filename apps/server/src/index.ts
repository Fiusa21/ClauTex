import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

const config = loadConfig();

let app;
try {
  app = await startServer(config);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(
    code === "EADDRINUSE"
      ? `Port ${String(config.port)} is already in use. Start with --port <number> or set TEXCOLLAB_PORT.`
      : `Could not start the server: ${String(err)}`,
  );
  process.exit(1);
}

console.log(`TexCollab is running at http://localhost:${String(config.port)}`);
console.log(`Projects are stored in ${config.workspace}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
