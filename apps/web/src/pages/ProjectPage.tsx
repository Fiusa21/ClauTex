import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../api/client.ts";
import {
  useCompile,
  useLastBuild,
  useSetCompiler,
  type CompileIssue,
} from "../api/compile.ts";
import { useProjectEvents } from "../api/events.ts";
import { useFiles, type FileEntry } from "../api/files.ts";
import { useHealth } from "../api/health.ts";
import { useSettings } from "../api/settings.ts";
import { useProject, type Compiler } from "../api/projects.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { ErrorPanel } from "../components/ErrorPanel.tsx";
import { CompilePanel } from "../editor/CompilePanel.tsx";
import { BinaryView } from "../editor/FileView.tsx";
import { FileTree } from "../editor/FileTree.tsx";
import {
  LocalEditor,
  type DiskChange,
  type EditorHandle,
  type Jump,
} from "../editor/LocalEditor.tsx";
import {
  hasPendingEdits,
  SAVE_LABELS,
  type SaveState,
} from "../editor/saveState.ts";
import { Splitter } from "../editor/Splitter.tsx";

const COMPILERS: { value: Compiler; label: string }[] = [
  { value: "pdflatex", label: "pdfLaTeX" },
  { value: "xelatex", label: "XeLaTeX" },
  { value: "lualatex", label: "LuaLaTeX" },
];

export function ProjectPage() {
  const { id = "" } = useParams();
  const project = useProject(id);
  const files = useFiles(id);
  const health = useHealth();
  const settings = useSettings();
  const lastBuild = useLastBuild(id);
  const compile = useCompile(id);
  const setCompiler = useSetCompiler(id);
  const [params, setParams] = useSearchParams();
  const [treeWidth, setTreeWidth] = useState(220);
  const [pdfWidth, setPdfWidth] = useState(() =>
    Math.round(window.innerWidth * 0.4),
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: "loading" });
  const [diskChange, setDiskChange] = useState<DiskChange | null>(null);
  const [jump, setJump] = useState<(Jump & { path: string }) | null>(null);
  const editor = useRef<EditorHandle>(null);

  useProjectEvents(id, (paths) => {
    setDiskChange({ paths, seq: Date.now() });
  });

  const select = useCallback(
    (file: FileEntry) => {
      // Write pending edits before opening another file.
      void (editor.current?.saveNow() ?? Promise.resolve()).finally(() => {
        setParams({ file: file.path }, { replace: true });
      });
    },
    [setParams],
  );

  /** Saves pending edits, then compiles (SPEC §6: the file on disk must be current). */
  const compileNow = () => {
    if (compile.isPending) return;
    void (editor.current?.saveNow() ?? Promise.resolve()).finally(() => {
      compile.mutate();
    });
  };
  const onShortcut = useEffectEvent(compileNow);

  // Ctrl/⌘+S and Ctrl/⌘+Enter save and compile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "Enter")) {
        e.preventDefault();
        onShortcut();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Warn before closing the tab with edits that are not on disk yet.
  useEffect(() => {
    if (!hasPendingEdits(saveState)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saveState]);

  if (project.isPending || files.isPending)
    return <p className="page-status">Loading…</p>;
  if (project.isError) {
    if (project.error instanceof ApiError && project.error.status === 404)
      return <ProjectNotFound />;
    return <ErrorPanel error={project.error} />;
  }
  if (files.isError) return <ErrorPanel error={files.error} />;

  const p = project.data;
  const requested = files.data.find((f) => f.path === params.get("file"));
  const current =
    requested && requested.kind !== "folder"
      ? requested
      : files.data.find((f) => f.path === p.mainFile);
  // In Docker mode a missing local TeX does not matter; Docker problems are reported by the compile.
  const dockerMode = settings.data?.compileMode === "docker";
  const texAvailable = dockerMode || (health.data?.tex.available ?? true);

  function jumpTo(issue: CompileIssue) {
    const target = files.data?.find(
      (f) => f.path === issue.file && f.kind === "doc",
    );
    if (!target) return; // e.g. a file of the TeX distribution
    select(target);
    setJump({ path: target.path, line: issue.line ?? 1, seq: Date.now() });
  }

  return (
    <>
      <AppHeader />
      <main className="workspace">
        <div className="workspace-bar">
          <Link to="/" className="muted">
            ← Projects
          </Link>
          <h1 className="workspace-title">{p.name}</h1>
          {current?.kind === "doc" && (
            <span
              className={`save-state save-${saveState.kind}`}
              role={
                saveState.kind === "error" || saveState.kind === "conflict"
                  ? "alert"
                  : "status"
              }
              data-testid="save-state"
              title={saveState.kind === "error" ? saveState.message : undefined}
            >
              {SAVE_LABELS[saveState.kind]}
            </span>
          )}
          <div className="compile-controls">
            <label className="visually-hidden" htmlFor="compiler">
              Compiler
            </label>
            <select
              id="compiler"
              value={p.compiler}
              disabled={setCompiler.isPending}
              onChange={(e) => {
                setCompiler.mutate(e.target.value as Compiler);
              }}
            >
              {COMPILERS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button primary"
              disabled={compile.isPending || !texAvailable}
              title="Save and compile (Ctrl/⌘ + S)"
              onClick={compileNow}
            >
              {compile.isPending ? "Compiling…" : "Compile"}
            </button>
          </div>
        </div>
        <div
          className="workspace-panes"
          style={
            {
              "--tree-width": `${String(treeWidth)}px`,
              "--pdf-width": `${String(pdfWidth)}px`,
            } as React.CSSProperties
          }
        >
          <FileTree
            projectId={p.id}
            files={files.data}
            mainFile={p.mainFile ?? ""}
            selectedId={current?.id}
            canEdit
            onSelect={select}
          />
          <Splitter
            label="Resize file tree"
            value={treeWidth}
            min={160}
            max={480}
            onChange={setTreeWidth}
          />
          <section
            className="editor-pane"
            aria-label={current ? current.path : "Editor"}
          >
            {current && (
              <div className="editor-path">
                <span>{current.path}</span>
              </div>
            )}
            {current?.kind === "doc" ? (
              <LocalEditor
                key={current.path}
                ref={editor}
                project={p.id}
                path={current.path}
                diskChange={diskChange}
                jump={jump?.path === current.path ? jump : undefined}
                onState={setSaveState}
              />
            ) : current?.kind === "binary" ? (
              <BinaryView projectId={p.id} file={current} />
            ) : (
              <p className="page-status">Select a file.</p>
            )}
          </section>
          <Splitter
            label="Resize PDF preview"
            value={pdfWidth}
            min={240}
            max={Math.round(window.innerWidth * 0.7)}
            invert
            onChange={setPdfWidth}
          />
          <CompilePanel
            project={p.id}
            build={compile.data ?? lastBuild.data}
            tex={dockerMode ? undefined : health.data?.tex}
            compiling={compile.isPending}
            compileError={compile.error}
            onJump={jumpTo}
          />
        </div>
      </main>
    </>
  );
}

function ProjectNotFound() {
  return (
    <main className="page">
      <div className="panel">
        <h1>Project not found</h1>
        <p className="muted">It may have been renamed, moved or deleted.</p>
        <Link to="/">Back to your projects</Link>
      </div>
    </main>
  );
}
