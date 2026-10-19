# CLAUDE.md — TexCollab

TexCollab is a lightweight, local LaTeX editor: clone the repo, run `npm start`, edit and compile LaTeX projects in the browser. Projects are plain folders on disk. It must work on Windows, macOS and Linux.
The full spec is in `docs/SPEC.md`. Read it before starting any milestone.

## Stack (decided — do not swap without asking)
- npm workspaces. `apps/web` — React + TypeScript + Vite, CodeMirror 6, pdf.js (`pdfjs-dist`), TanStack Query, React Router.
- `apps/server` — Node.js 24 LTS + TypeScript run directly via Node's type stripping (no build step), Fastify.
- No database. Projects are folders in the workspace folder; app settings and build output live in the OS config/cache folders.
- Compiling uses the locally installed `latexmk`; Docker (`texlive/texlive`, pinned by digest) is an optional fallback.

Before adding a dependency, check its current name, version and maintenance status. Prefer few, well-maintained libraries. **No native add-ons** (nothing that needs node-gyp or a C/C++ toolchain).

## Hard rules
1. **Clean-room.** Overleaf is AGPL-3.0. Do not copy, paste or closely translate Overleaf source code. Implement from `docs/SPEC.md` and public library docs only.
2. **Local server safety.** Listen on 127.0.0.1 only. Every request passes the Host and Origin checks (SPEC §5). Never send CORS headers.
3. **Path safety.** Every user-supplied path or project name is normalized and validated (no `..`, absolute paths, backslashes, NUL, control characters, drive letters, Windows reserved names, max length) and must resolve inside its project folder after following symlinks — before touching disk.
4. **Compile safety.** Run latexmk without a shell (argument array), always with `-no-shell-escape` and `-norc`, with a hard timeout that kills the whole process tree on every OS.
5. **Platform independence.** No shell-specific npm scripts (no `rm -rf`, `FOO=bar cmd`, `&` backgrounding): use small Node scripts in `scripts/`. Use `node:path` for disk paths and `/`-separated paths in the API. Test on all three OSes in CI.
6. No secrets in the repo.

## How to work
- Build milestone by milestone (SPEC §8). Finish one, with its acceptance checks passing, before starting the next.
- Keep commits small and descriptive. Update `docs/SPEC.md` when a decision changes, and add new decisions to `docs/DECISIONS.md` (date, decision, reason).
- Write tests alongside code: Vitest (web, server), Playwright for end-to-end flows.
- Before calling something done: run the tests, start the app with `npm start`, and verify the flow in a browser.
- If something in the spec is unclear or seems wrong, ask instead of guessing.

## Commands (from the repo root)
- Install: `npm install`
- Start the app: `npm start` → http://localhost:8765 (builds the web app, then starts the server)
- Develop with hot reload: `npm run dev` → http://localhost:5173 (Vite, proxies `/api` to the server)
- Lint / typecheck / unit tests (all packages): `npm run lint` · `npm run typecheck` · `npm test`
- E2E: `npm run e2e` (starts the app against a temporary workspace)
