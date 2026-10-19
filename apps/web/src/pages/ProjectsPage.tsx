import { useId, useRef, useState, type SubmitEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useHealth } from "../api/health.ts";
import {
  exportUrl,
  projectPage,
  useCreateProject,
  useDeleteProject,
  useDuplicateProject,
  useImportZip,
  useProjects,
  useRenameProject,
  useRestoreProject,
  useTrash,
  type Project,
} from "../api/projects.ts";
import { useOpenFolder, useRemoveFolder } from "../api/settings.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { ErrorPanel } from "../components/ErrorPanel.tsx";
import { FormError } from "../components/FormError.tsx";
import { formatDateTime } from "./format.ts";

export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const trash = params.get("view") === "trash";
  const health = useHealth();

  return (
    <>
      <AppHeader />
      <main className="page">
        <div className="page-head">
          <h1>{trash ? "Trash" : "Projects"}</h1>
          <nav className="tabs" aria-label="Project views">
            <button
              type="button"
              className="tab"
              aria-current={!trash ? "page" : undefined}
              onClick={() => {
                setParams({});
              }}
            >
              Projects
            </button>
            <button
              type="button"
              className="tab"
              aria-current={trash ? "page" : undefined}
              onClick={() => {
                setParams({ view: "trash" });
              }}
            >
              Trash
            </button>
          </nav>
        </div>
        {health.isError && <ErrorPanel error={health.error} />}
        {health.data && (
          <p className="muted workspace-path" data-testid="workspace">
            Stored in <code>{health.data.workspace}</code> ·{" "}
            <Link to="/settings">Change</Link>
          </p>
        )}
        {trash ? <TrashList /> : <ActiveProjects />}
      </main>
    </>
  );
}

function ActiveProjects() {
  const projects = useProjects();
  const own = projects.data?.filter((p) => !p.external) ?? [];
  const opened = projects.data?.filter((p) => p.external) ?? [];
  return (
    <>
      <CreateProjectForm />
      <div className="secondary-actions">
        <ImportZipButton />
        <OpenFolderForm />
      </div>
      {projects.isPending && <p className="page-status">Loading projects…</p>}
      {projects.isError && <ErrorPanel error={projects.error} />}
      {projects.data && own.length === 0 && opened.length === 0 && (
        <p className="empty">No projects yet. Create your first one above.</p>
      )}
      {own.length > 0 && (
        <ul className="project-list" aria-label="Projects">
          {own.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </ul>
      )}
      {opened.length > 0 && (
        <>
          <h2>Opened folders</h2>
          <ul className="project-list" aria-label="Opened folders">
            {opened.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function CreateProjectForm() {
  const [name, setName] = useState("");
  const create = useCreateProject();

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    create.mutate(name.trim(), {
      onSuccess: () => {
        setName("");
      },
    });
  }

  return (
    <form className="create-form" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="new-project-name">
        New project name
      </label>
      <input
        id="new-project-name"
        placeholder="New project name"
        required
        maxLength={120}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <button className="button primary" disabled={create.isPending}>
        Create project
      </button>
      <FormError error={create.error} />
    </form>
  );
}

function ImportZipButton() {
  const input = useRef<HTMLInputElement>(null);
  const importZip = useImportZip();
  const navigate = useNavigate();
  return (
    <div className="inline-action">
      <button
        type="button"
        className="button ghost"
        disabled={importZip.isPending}
        onClick={() => input.current?.click()}
      >
        {importZip.isPending ? "Importing…" : "Import ZIP"}
      </button>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            importZip.mutate(file, {
              onSuccess: (project) => void navigate(projectPage(project.id)),
            });
          }
        }}
      />
      <FormError error={importZip.error} />
    </div>
  );
}

function OpenFolderForm() {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const openFolder = useOpenFolder();
  const navigate = useNavigate();
  const inputId = useId();

  if (!open) {
    return (
      <button
        type="button"
        className="button ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open folder…
      </button>
    );
  }
  return (
    <form
      className="open-folder-form"
      onSubmit={(e) => {
        e.preventDefault();
        openFolder.mutate(path.trim(), {
          onSuccess: (project) => void navigate(projectPage(project.id)),
        });
      }}
    >
      <label htmlFor={inputId}>Folder path</label>
      <input
        id={inputId}
        autoFocus
        required
        placeholder="/Users/me/thesis  or  C:\Users\me\thesis"
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <button className="button primary" disabled={openFolder.isPending}>
        Open
      </button>
      <button
        type="button"
        className="button ghost"
        onClick={() => {
          setOpen(false);
        }}
      >
        Cancel
      </button>
      <FormError error={openFolder.error} />
    </form>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  const rename = useRenameProject();
  const remove = useDeleteProject();
  const duplicate = useDuplicateProject();
  const removeFolder = useRemoveFolder();
  const error =
    rename.error ?? remove.error ?? duplicate.error ?? removeFolder.error;

  return (
    <li className="project-row" data-testid="project-row">
      <div className="project-main">
        {editing ? (
          <RenameForm
            initial={project.name}
            pending={rename.isPending}
            onCancel={() => {
              setEditing(false);
            }}
            onSave={(newName) => {
              rename.mutate(
                { id: project.id, newName },
                {
                  onSuccess: () => {
                    setEditing(false);
                  },
                },
              );
            }}
          />
        ) : (
          <Link className="project-name" to={projectPage(project.id)}>
            {project.name}
          </Link>
        )}
        <span className="project-meta muted">
          {project.path && <code className="project-path">{project.path}</code>}
          <span>Updated {formatDateTime(project.updatedAt)}</span>
          {project.mainFile && <span>Main file: {project.mainFile}</span>}
        </span>
        <FormError error={error} />
      </div>
      <div className="row-actions">
        {!project.external && !editing && (
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              rename.reset();
              setEditing(true);
            }}
          >
            Rename
          </button>
        )}
        <button
          type="button"
          className="button ghost"
          disabled={duplicate.isPending}
          title={project.external ? "Copy into the workspace" : undefined}
          onClick={() => {
            duplicate.mutate(project.id);
          }}
        >
          Duplicate
        </button>
        <a className="button ghost" href={exportUrl(project.id)} download>
          Export
        </a>
        {project.external ? (
          <button
            type="button"
            className="button ghost"
            disabled={removeFolder.isPending}
            title="The folder stays on disk"
            onClick={() => {
              if (project.path) removeFolder.mutate(project.path);
            }}
          >
            Remove from list
          </button>
        ) : (
          <button
            type="button"
            className="button ghost danger"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Move “${project.name}” to the trash? You can restore it from Trash.`,
                )
              ) {
                remove.mutate(project.id);
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

function RenameForm(props: {
  initial: string;
  pending: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial);
  const inputId = useId();
  return (
    <form
      className="rename-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave(name.trim());
      }}
    >
      <label className="visually-hidden" htmlFor={inputId}>
        New name for {props.initial}
      </label>
      <input
        id={inputId}
        autoFocus
        required
        maxLength={120}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel();
        }}
      />
      <button className="button primary" disabled={props.pending}>
        Save
      </button>
      <button type="button" className="button ghost" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}

function TrashList() {
  const trash = useTrash();
  const restore = useRestoreProject();

  if (trash.isPending) return <p className="page-status">Loading…</p>;
  if (trash.isError) return <ErrorPanel error={trash.error} />;
  if (trash.data.length === 0) {
    return <p className="empty">Trash is empty.</p>;
  }
  return (
    <>
      <p className="muted">
        Deleted projects stay in the <code>.trash</code> folder of your
        workspace until you remove them there.
      </p>
      <FormError error={restore.error} />
      <ul className="project-list" aria-label="Deleted projects">
        {trash.data.map((t) => (
          <li key={t.entry} className="project-row" data-testid="trash-row">
            <div className="project-main">
              <span className="project-name">{t.name}</span>
              <span className="project-meta muted">
                Deleted {formatDateTime(t.deletedAt)}
              </span>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="button ghost"
                disabled={restore.isPending}
                onClick={() => {
                  restore.mutate(t.entry);
                }}
              >
                Restore
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
