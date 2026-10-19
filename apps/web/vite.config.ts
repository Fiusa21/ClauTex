import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `npm run dev` (repo root) runs the server in dev mode on this port; Vite proxies the API to it.
const serverPort = process.env.TEXCOLLAB_PORT ?? "8765";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
