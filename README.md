# TexCollab

A lightweight LaTeX editor that runs locally. Clone it, start it with one command, and edit and compile LaTeX projects in your browser — offline, on Windows, macOS or Linux. Your projects are ordinary folders on disk, so they work with git and any other editor.

Spec: [`docs/SPEC.md`](docs/SPEC.md) · Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md) · Contributor rules: [`CLAUDE.md`](CLAUDE.md)

**Status:** v1 feature-complete (L4). Projects and files on disk, a LaTeX editor with autosave that notices changes made by other programs, compiling with your TeX installation or in Docker, PDF preview with clickable errors, ZIP import/export, opening existing folders, and a settings page. A hosted, collaborative version may follow later.

## Setup

You need **Node.js 24 LTS** (24.15 or newer) and, to compile, **either a TeX distribution or Docker**.

### Windows

1. Install [Node.js 24 LTS](https://nodejs.org) (the Windows installer).
2. Install TeX: [TeX Live](https://tug.org/texlive/windows.html) (includes `latexmk` and Perl) or [MiKTeX](https://miktex.org/download) (installs Perl and missing packages on demand).
   *Or* install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and choose Docker in TexCollab's settings.
3. Open a new terminal (so it sees the new `PATH`) and run the commands under [Run it](#run-it).

### macOS

1. Install Node.js 24 LTS from [nodejs.org](https://nodejs.org) or with Homebrew: `brew install node@24`.
2. Install TeX: [MacTeX](https://tug.org/mactex/), or `brew install --cask mactex-no-gui`. Make sure `/Library/TeX/texbin` is on your `PATH`.
   *Or* install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and choose Docker in the settings.

### Linux

1. Install Node.js 24 LTS ([nodejs.org](https://nodejs.org), your distribution, or a version manager such as `nvm`).
2. Install TeX:
   - Debian/Ubuntu: `sudo apt install texlive-full latexmk` (or a smaller set such as `texlive-latex-extra texlive-xetex texlive-luatex latexmk`)
   - Fedora: `sudo dnf install texlive-scheme-full latexmk`
   - Arch: `sudo pacman -S texlive texlive-binextra`
   *Or* install Docker and choose Docker in the settings.

## Run it

```sh
git clone <this repository> texcollab
cd texcollab
npm install
npm start
```

Open <http://localhost:8765>. Projects are stored in `Documents/TexCollab` (or `TexCollab` in your home folder if there is no Documents folder) — change that in **Settings**.

Without TeX the app still runs: the PDF pane explains how to install it, and **Settings → Compile with Docker** compiles in the official TeX Live image instead (about 2.8 GB, downloaded once from the settings page).

| Flag (after `npm start --`) | Environment variable | Default |
|---|---|---|
| `--port <n>` | `TEXCOLLAB_PORT` | `8765` |
| `--workspace <dir>` | `TEXCOLLAB_WORKSPACE` | `~/Documents/TexCollab` (when set here, the settings page cannot change it) |

Example: `npm start -- --port 9000 --workspace ~/latex`

### What you can do

- **Projects**: create, rename, duplicate, delete (to a restorable trash), **import a ZIP**, **export as ZIP**, and **open any existing folder** (“Open folder…”, then paste its path). Opened folders are edited in place and listed under “Opened folders”.
- **Files**: folders, uploads (images, PDFs, up to 50 MB), drag to move, rename, delete (goes to `.trash` in your workspace).
- **Editor**: LaTeX highlighting, completion, search; autosave about a second after you stop typing; changes made by other programs appear live, and conflicting edits ask before anything is overwritten.
- **Compile**: Ctrl/⌘+S saves and compiles, Ctrl/⌘+Enter compiles. Errors and warnings link to the line. pdfLaTeX, XeLaTeX or LuaLaTeX per project. Shell escape is always off and a project's `.latexmkrc` is not executed.

### Privacy and safety

The server only listens on `127.0.0.1` and refuses requests from other websites, so nothing outside your machine — and no other site open in your browser — can reach your files. Nothing is uploaded anywhere.

## Develop

| Task | Command (repo root) |
|---|---|
| App with hot reload (server + Vite) | `npm run dev` → <http://localhost:5173> |
| Lint / typecheck / unit tests | `npm run lint` · `npm run typecheck` · `npm test` |
| End-to-end tests (Playwright; first time: `npx playwright install chromium` in `apps/web`). Fake latexmk and docker, temporary folders. | `npm run e2e` |
| …with your real TeX installation | `TEXCOLLAB_E2E_REAL_TEX=1 npm run e2e` |

Layout: `apps/web` (React, Vite, CodeMirror, pdf.js) and `apps/server` (Node.js, Fastify; TypeScript runs directly, no build step). CI runs everything on Ubuntu, macOS and Windows, plus a job with a real TeX installation.
