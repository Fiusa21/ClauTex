# TexCollab — Product & Technical Specification (local v1)

Status: draft, 2026-10-19.

## 1. Goal
A lightweight LaTeX editor that runs **locally**: clone the repository, run one command, edit and compile LaTeX projects in the browser with the PDF next to the source. It works offline and on **Windows, macOS and Linux**.

### In scope for v1
- One command to start: `npm install` once, then `npm start`; open `http://localhost:8765`.
- Projects are **plain folders on disk** inside a workspace folder (default `Documents/TexCollab`), usable with git and other editors.
- Project list: create, rename, duplicate, delete (to a restorable trash), open.
- File tree: folders, text files, uploaded images/PDFs; create, rename, move (drag), delete, upload, download.
- Code editor with LaTeX highlighting, search, bracket matching, autocomplete; autosave.
- Picks up changes made to files by other programs.
- Compile with the **locally installed TeX** (latexmk; pdfLaTeX, XeLaTeX, LuaLaTeX); optional compile in Docker when TeX is not installed. PDF preview, readable error list with jump-to-line.
- Import/export a project as ZIP.

### Not in v1
Accounts, sharing, real-time collaboration (a possible later version), SyncTeX, version history UI, comments, spell check, templates, desktop packaging (installers).

## 2. Architecture

```
Browser (React SPA)  ──HTTP/SSE on 127.0.0.1──►  Local server (Node.js)
                                                   ├── workspace folder (projects = folders)
                                                   ├── latexmk (local TeX) or docker (optional)
                                                   └── build cache (OS cache dir)
```

One Node.js process serves the built web app and a JSON API under `/api`, plus a server-sent-events stream for file changes. No database, no accounts, no other services.

Repository layout (npm workspaces):
- `apps/web` — React + TypeScript + Vite, CodeMirror 6, pdf.js.
- `apps/server` — Node.js (LTS) + TypeScript, Fastify. Runs TypeScript directly via Node's type stripping (no server build step).
- Root `package.json` — `npm start`, `npm run dev`, `npm test`, `npm run lint`.

Requirements for users: Node.js 24 LTS (≥ 24.15) and, for compiling, a TeX distribution with latexmk (TeX Live, MacTeX or MiKTeX) — or Docker for the optional container compile. No native Node add-ons (installs must not need a C/C++ toolchain).

## 3. Storage

Workspace folder: `TEXCOLLAB_WORKSPACE` env var or `--workspace <dir>`; default `<home>/Documents/TexCollab` if a Documents folder exists, else `<home>/TexCollab`. Created on first start.

- Every direct subfolder is a project; its folder name is the project name. Folders starting with `.` are ignored.
- `<project>/.texcollab.json` (optional): `{ "mainFile": "main.tex", "compiler": "pdflatex" | "xelatex" | "lualatex" }`. Missing → defaults (`main.tex` if present, else the first `.tex` file in the root; `pdflatex`).
- Project ids in the API are the folder names, URL-encoded; renaming a project renames its folder.
- Deleted projects move to `<workspace>/.trash/<name>~<timestamp>/` and can be restored from the Trash view; deleted files and folders move to `<workspace>/.trash/<project>/<timestamp>/<path>` (recoverable with a file manager). The trash is never emptied automatically.
- Build output goes to a per-project directory in the OS cache folder (`%LOCALAPPDATA%\TexCollab\Cache`, `~/Library/Caches/TexCollab`, `$XDG_CACHE_HOME/texcollab` or `~/.cache/texcollab`), never into the project folder. The last build per project is kept.
- Text files are written atomically (write a temporary file in the same folder, then rename) and keep their line endings; new files use LF.
- Text vs. binary by extension: `.tex .bib .sty .cls .txt .md .bst .cfg .def .dtx .ins .csv .tikz .lua` and `.latexmkrc` are editable text (UTF-8; other encodings are shown read-only with a notice). Max editable size 2 MB. Upload limit 50 MB per file.

## 4. Local server API

All under `/api`, JSON, errors as RFC 7807 problem+json with a stable `code`.

Health and settings
- `GET /api/health` → `{ status, version, workspace, tex: { available, latexmk, engines[], docker } }`
- `GET /api/settings`, `PATCH /api/settings` {workspace?, compileMode?: "local" | "docker"}; stored in the OS config folder.

Projects
- `GET /api/projects` — name, updatedAt (latest file mtime), mainFile
- `POST /api/projects` {name} — new folder with a starter `main.tex`
- `GET /api/projects/{name}`, `PATCH /api/projects/{name}` {name?, mainFile?, compiler?}
- `DELETE /api/projects/{name}` → moves to trash; `GET /api/trash`, `POST /api/trash/{entry}/restore`
- `POST /api/projects/{name}/duplicate` {name?}
- `POST /api/projects/import` (ZIP), `GET /api/projects/{name}/export.zip`

Files
- `GET /api/projects/{name}/files` — tree as a flat list (path, kind: folder|file, text, size, mtime); hidden entries (starting with `.`) and symlinks leading outside the project are not listed. Paths with hidden segments are rejected by every file endpoint (no writing to `.git/…` or `.texcollab.json` through the API).
- `GET /api/projects/{name}/files/content?path=[&download=true]` — raw bytes (any file type), typed by extension, sandboxed
- `GET /api/projects/{name}/files/text?path=` → `{ text, etag, editable, encoding, lineEnding, reason }` for the editor: text with LF line endings; `etag` is a hash of the exact bytes on disk; `editable` is false for non-UTF-8 (`reason: "not_utf8"`, shown as Windows-1252) or files over 2 MB (`"too_large"`)
- `PUT /api/projects/{name}/files/text?path=` {text, baseEtag} → `{ etag }` — saves only if the file on disk is still `baseEtag`, else `409 file_changed` with the current `etag`; keeps the file's line endings (LF/CRLF) and UTF-8 BOM; atomic write; `423 file_locked` when another program holds the file (Windows)
- `POST /api/projects/{name}/files/convert?path=` — re-encodes a Windows-1252 file as UTF-8 (only on explicit request)
- `POST /api/projects/{name}/files` {path, kind: folder|file} (missing parent folders are created); `POST …/files/upload?path=&replace=` (multipart field `file`, max 50 MB, written to a temporary file and renamed into place; `path` defaults to the uploaded file's base name)
- `PATCH /api/projects/{name}/files` {from, to} — rename/move (folders with contents; case-only renames work; the main file follows); `DELETE …/files?path=` (to the trash; the main file and folders containing it are protected)
- `GET /api/projects/{name}/events` — server-sent events: `ready`, then `change` with `{ paths }` (project-relative, batched over 150 ms, hidden entries skipped) for any change on disk, including the app's own saves; `unavailable` if the folder cannot be watched

Compile
- `POST /api/projects/{name}/compile` → `{ status, errors, logExcerpt, pdfUrl, durationMs }`
- `GET /api/projects/{name}/output.pdf`, `GET /api/projects/{name}/output.log`

## 5. Local security

The server holds the user's files, so a website open in the same browser must not be able to read or change them:
- Listen on `127.0.0.1` only (no LAN access in v1).
- **Host check** on every request: `Host` must be `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>` (blocks DNS rebinding).
- **Origin check**: requests with an `Origin` header that is not the app's own origin are rejected; requests with `Sec-Fetch-Site: cross-site` are rejected. No CORS headers are ever sent.
- **Path safety**: every client path is normalized and validated (no `..`, absolute paths, backslashes, NUL, control characters, Windows drive letters or reserved names like `CON`/`NUL`, max length) and must resolve — after following symlinks — inside the project folder. Project names follow the same rules plus "no `/`".
- Served user files: content type from the extension, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, images inline, everything else as attachment.

## 6. Compile

Local mode (default):
1. Save pending edits (the client flushes autosave first).
2. Run `latexmk` **without a shell** (argument array): `-<engine> -interaction=nonstopmode -halt-on-error -file-line-error -no-shell-escape -norc -outdir=<cache dir> -jobname=output ./<main file>` in the main file's folder.
   - `-norc`: project `.latexmkrc` files are not executed (they are Perl and would bypass `-no-shell-escape`). A per-project opt-in may come later.
   - Environment: `max_print_line=10000`, `error_line=254`, `half_error_line=238`, `openout_any=p`.
3. Hard timeout 60 s: kill the whole process tree (POSIX: process group; Windows: `taskkill /T /F`). One compile per project at a time.
4. Parse the log (§6.1) and return errors, a log excerpt and the PDF URL. Output size cap 50 MB.

TeX detection at startup and in `/api/health`: `latexmk -v` and the engines on `PATH`; the UI shows install instructions per OS when missing (latexmk on Windows needs Perl, which TeX Live ships; MiKTeX installs it on demand).

Docker mode (optional, when TeX is missing): the same command in `texlive/texlive:latest-full` pinned by digest, via the `docker` CLI, with sandbox flags (no network, read-only, non-root, CPU/memory/pids limits, sources via stdin tar).

### 6.1 Log parsing
`file:line:` errors, `!` errors with `l.N`, LaTeX/package warnings with input lines, over/underfull boxes; TeX's follow-up messages after an error are dropped; paths are mapped back to project paths and never outside the project; at most 100 issues.

## 7. Frontend

Routes: `/` (project list), `/project/:name`.
Editor page: file tree | editor | PDF (resizable; stacked below 900 px). Top bar: project name, save state ("Saved", "Unsaved changes", "Saving…", "Changed on disk", "Deleted on disk", "Read-only", "Save failed"), compiler select, Compile (Ctrl/Cmd+S or Ctrl/Cmd+Enter). Error list with jump-to-line.
Saving: autosave ~1 s after typing stops; Ctrl/Cmd+S saves at once (and compiles from L3); pending edits are written before switching files and when the editor closes; leaving the page with unsaved edits asks first. When a file open in the editor changes on disk: reload silently if there are no unsaved edits, otherwise pause autosave and ask (keep mine / load from disk). Non-UTF-8 files open read-only with a "Convert to UTF-8" button.
First start without TeX: a setup panel with per-OS instructions and the Docker option.
Design: clean, minimal, keyboard friendly, light and dark mode.

## 8. Milestones and acceptance checks

L0 — Restructure
- npm workspaces (`apps/web`, `apps/server`); `npm start` serves the app; `/api/health`; Host/Origin guards; CI lint + tests + an end-to-end smoke test on Ubuntu, macOS and Windows.
- ✔ Fresh clone → `npm install && npm start` → app loads at `http://localhost:8765` on all three OSes (CI). Requests with a foreign `Host` or `Origin` are rejected (tested).

L1 — Projects and files on disk
- ✔ Create/rename/duplicate/delete/restore projects; file tree CRUD and uploads change the folders on disk as expected. Path traversal, absolute paths, Windows reserved names and symlinks out of the project are rejected (tested on all OSes).

L2 — Editor
- ✔ Edit, autosave, reload: content is on disk. A file changed by another program updates in the editor; a conflicting edit asks the user.

L3 — Compile
- ✔ Starter project compiles with local TeX; an error shows file + line and jumps there; `\write18` does nothing; an infinite loop is killed after 60 s with no leftover processes (Linux, macOS, Windows). Docker mode compiles when selected.

L4 — Polish
- ✔ ZIP round-trip preserves all files; settings (workspace, compile mode) persist; README has setup steps for each OS.

Later: a hosted, collaborative version (accounts, sharing, real-time editing) could reuse the editor and compile UI.

## 9. Quality bar
- Every endpoint goes through the Host/Origin guard and path validation (tested).
- Unit and integration tests run on Ubuntu, macOS and Windows in CI.
- No unhandled promise rejections or uncaught exceptions during E2E runs.
- README with setup steps per OS.
