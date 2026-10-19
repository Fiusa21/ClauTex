# TexCollab

A lightweight LaTeX editor that runs locally. Clone it, start it with one command, and edit and compile LaTeX projects in your browser — offline, on Windows, macOS or Linux. Your projects are ordinary folders on disk, so they work with git and any other editor.

Spec: [`docs/SPEC.md`](docs/SPEC.md) · Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md) · Contributor rules: [`CLAUDE.md`](CLAUDE.md)

**Status:** L3 (compile). Projects and files on disk, a LaTeX editor with autosave, and compiling with your local TeX installation — PDF preview, clickable errors and warnings. Polish (ZIP import/export, settings page, optional Docker compile) is next (L4). A hosted, collaborative version may follow later.

## Requirements

- [Node.js](https://nodejs.org) 24 LTS (24.15 or newer). Check with `node --version`.
- For compiling: a TeX distribution with `latexmk` on your PATH — [TeX Live](https://tug.org/texlive/) (Windows/Linux, e.g. `sudo apt install texlive-full latexmk`), [MacTeX](https://tug.org/mactex/) (macOS) or [MiKTeX](https://miktex.org/) (Windows). Without TeX the app still runs and shows install instructions; Docker will be an optional alternative (L4).

## Run it

```sh
git clone <this repository> texcollab
cd texcollab
npm install
npm start
```

Open <http://localhost:8765>. Projects are stored in `Documents/TexCollab` (or `TexCollab` in your home folder if there is no Documents folder).

Options (after `npm start --`):

| Flag | Environment variable | Default |
|---|---|---|
| `--port <n>` | `TEXCOLLAB_PORT` | `8765` |
| `--workspace <dir>` | `TEXCOLLAB_WORKSPACE` | `~/Documents/TexCollab` |

Example: `npm start -- --port 9000 --workspace ~/Documents/latex`

The server only listens on `127.0.0.1` and rejects requests from other websites, so nothing outside your machine — and no other site open in your browser — can reach your files.

## Develop

| Task | Command (repo root) |
|---|---|
| App with hot reload (server + Vite) | `npm run dev` → <http://localhost:5173> |
| Lint / typecheck / unit tests | `npm run lint` · `npm run typecheck` · `npm test` |
| End-to-end tests (Playwright; first time: `npx playwright install chromium` in `apps/web`). Uses a fake latexmk and temporary folders. | `npm run e2e` |
| …with your real TeX installation | `TEXCOLLAB_E2E_REAL_TEX=1 npm run e2e` |

Layout: `apps/web` (React, Vite, CodeMirror, pdf.js) and `apps/server` (Node.js, Fastify; TypeScript runs directly, no build step). CI runs everything on Ubuntu, macOS and Windows.
