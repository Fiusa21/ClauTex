# Decisions

Format: date — decision — reason.

## 2026-10-19 (L0)

- **v1 is a lightweight local editor.** — People should be able to clone the repository and run it on their own machine. A hosted, collaborative version may follow later.
- **Runtime: Node.js 24 LTS + TypeScript, one process** (user's choice; must be platform independent). Users need only Node (and TeX for compiling).
- **Projects are plain folders** in a workspace folder (default `~/TexCollab`); settings and build output in OS config/cache folders (user's choice).
- **Compile with local TeX by default, Docker optional** (user's choice). Compile safety: no shell, `-no-shell-escape`, `-norc`, process-tree timeout (CLAUDE.md rule 4).
- **Fastify 5.12 + @fastify/static 10.1** for the server. — Mature, well maintained, no native add-ons, works on all OSes.
- **The server runs TypeScript directly via Node's type stripping** (no server build step). Node 24.15+ is required; it runs without the experimental warning from 24.x (checked on 24.22). The web app is still built with Vite (`npm start` builds it first).
- **npm workspaces** (`apps/web`, `apps/server`) with one root lockfile; root scripts run per-package scripts. Cross-platform helpers live in `scripts/*.mjs` (no shell-specific npm scripts).
- **Port 8765, 127.0.0.1 only.** Host check on every request (DNS rebinding); for `/api`, a foreign `Origin` or `Sec-Fetch-Site: cross-site` is rejected; no CORS headers. Other local apps on other ports count as foreign. Requests without `Origin` (curl) are allowed — they can only come from the user's own machine. Navigation to the web app from other sites (links) is allowed.
- **`npm run dev`** starts the server with `--dev` (which additionally allows the Vite origin `http://localhost:5173`) and Vite, which proxies `/api`.
- **E2E starts the real server** with a fresh temporary workspace via Playwright's `webServer` — no running stack needed, identical on all OSes.
- **CI: one matrix job on Ubuntu, macOS and Windows** (lint, typecheck, unit tests, e2e). `.gitattributes` enforces LF so Prettier passes on Windows checkouts.
