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

## 2026-10-19 (before L1)

User-confirmed defaults:
- **Default workspace: `<home>/Documents/TexCollab` if a Documents folder exists, else `<home>/TexCollab`.**
- **v1 works on projects inside the workspace only.** "Open any folder" (recent folders list) is deferred to L4.

## 2026-10-19 (L1)

- **Portable names everywhere**: paths and project names that Windows cannot store (`CON`, `aux.tex`, `<>:"|?*`, trailing dot/space) are rejected on every OS. — A project created on macOS must open on Windows.
- **Hidden path segments are rejected by the file API** (and hidden entries are not listed). — Prevents writing to `.git/hooks` (code execution on the next git command) or overwriting `.texcollab.json`. Consequence: `.latexmkrc` is not editable in the app (it is ignored at compile time anyway, `-norc`).
- **Symlinks**: followed only when their target stays inside the project; directory links are never recursed into (cycles). Containment is checked on the real path of the deepest existing ancestor, so new files cannot be created through an outward link. Windows tests use junctions (no admin rights needed).
- **Deleted files go to `<workspace>/.trash/<project>/<timestamp>/<path>`**, not to permanent deletion. — They are the user's real files; recovery via the file manager is enough for v1.
- **Project trash entries are named `<name>~<UTC timestamp>`**, so restoring needs no extra metadata files inside the user's folder.
- **Rename targets resolve only the parent**: resolving the full target returned the existing file's case on case-insensitive file systems and turned "intro" → "Intro" into a no-op (found by a test). Case-only project renames compare device+inode to tell "same folder" from "another folder" on Linux.
- **Uploads** are written to a temporary file in the target folder and renamed into place (no half-written files); `@fastify/multipart` 10.1 (pure JS) enforces the 50 MB limit.
- **The web app identifies files by path** (`id === path`), keeping the existing tree component; renaming the open file keeps it selected.
- **Text files are shown read-only in L1**; editing (with autosave and external-change detection) is L2.

## 2026-10-19 (before L2)

User-confirmed defaults:
- **Autosave ~1 s after typing stops**; Ctrl/⌘+S saves immediately (and compiles from L3 on).
- **Non-UTF-8 text files open read-only with a "Convert to UTF-8" button**; the app never changes a file's encoding on its own.

## 2026-10-19 (L2)

- **Conflict detection uses a SHA-256 hash of the file's bytes as ETag**, not mtime+size. — Two saves within the filesystem's timestamp resolution with equal size would otherwise look identical and an external change could be overwritten.
- **The editor works in LF; the server writes the file's original line endings and BOM back.** — Editing a Windows file must not rewrite every line.
- **Saves are atomic** (temporary file in the same folder + rename). A Windows sharing violation becomes `423 file_locked` instead of a 500.
- **Live changes via one recursive `fs.watch` per open project**, shared by all browser tabs, batched over 150 ms, sent as server-sent events. The app's own saves also produce events; the editor recognizes them by ETag. The file tree refreshes on every event.
- **Save logic is a framework-free class (`EditorSync`)**, unit-tested with fake timers: debounced autosave, one save at a time (edits during a save are saved afterwards against the new version), conflict on 409 or on an external change while dirty (autosave pauses until the user decides), silent reload when clean, write-on-close with `fetch(…, { keepalive: true })`. — React's hook rules (and testability) argued against keeping it in the component.
- **CodeMirror's own history** for undo/redo; LaTeX highlighting (sTeX mode), completions and theme are our own extension set.
