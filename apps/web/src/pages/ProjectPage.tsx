import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { useProjectEvents } from "../api/events.ts";
import { useFiles, type FileEntry } from "../api/files.ts";
import { useProject } from "../api/projects.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { ErrorPanel } from "../components/ErrorPanel.tsx";
import { BinaryView } from "../editor/FileView.tsx";
import { FileTree } from "../editor/FileTree.tsx";
import {
  LocalEditor,
  type DiskChange,
  type EditorHandle,
} from "../editor/LocalEditor.tsx";
import {
  hasPendingEdits,
  SAVE_LABELS,
  type SaveState,
} from "../editor/saveState.ts";
import { Splitter } from "../editor/Splitter.tsx";

export function ProjectPage() {
  const { name = "" } = useParams();
  const project = useProject(name);
  const files = useFiles(name);
  const [params, setParams] = useSearchParams();
  const [treeWidth, setTreeWidth] = useState(240);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "loading" });
  const [diskChange, setDiskChange] = useState<DiskChange | null>(null);
  const editor = useRef<EditorHandle>(null);

  useProjectEvents(name, (paths) => {
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

  // Ctrl/⌘+S saves now (and will also compile from L3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void editor.current?.saveNow();
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
        </div>
        <div
          className="workspace-panes two-panes"
          style={
            { "--tree-width": `${String(treeWidth)}px` } as React.CSSProperties
          }
        >
          <FileTree
            projectId={p.name}
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
                project={p.name}
                path={current.path}
                diskChange={diskChange}
                onState={setSaveState}
              />
            ) : current?.kind === "binary" ? (
              <BinaryView projectId={p.name} file={current} />
            ) : (
              <p className="page-status">Select a file.</p>
            )}
          </section>
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
