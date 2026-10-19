import { useCallback, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { useFiles, type FileEntry } from "../api/files.ts";
import { useProject } from "../api/projects.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { ErrorPanel } from "../components/ErrorPanel.tsx";
import { BinaryView } from "../editor/FileView.tsx";
import { FileTree } from "../editor/FileTree.tsx";
import { Splitter } from "../editor/Splitter.tsx";
import { TextPreview } from "../editor/TextPreview.tsx";

export function ProjectPage() {
  const { name = "" } = useParams();
  const project = useProject(name);
  const files = useFiles(name);
  const [params, setParams] = useSearchParams();
  const [treeWidth, setTreeWidth] = useState(240);

  const select = useCallback(
    (file: FileEntry) => {
      setParams({ file: file.path }, { replace: true });
    },
    [setParams],
  );

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
            aria-label={current ? current.path : "Preview"}
          >
            {current && (
              <div className="editor-path">
                <span>{current.path}</span>
              </div>
            )}
            {current?.kind === "doc" ? (
              <TextPreview
                key={current.path}
                project={p.name}
                path={current.path}
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
