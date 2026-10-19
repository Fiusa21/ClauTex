import { useId, useState, type SubmitEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useHealth } from "../api/health.ts";
import {
  useCreateProject,
  useDeleteProject,
  useDuplicateProject,
  useProjects,
  useRenameProject,
  useRestoreProject,
  useTrash,
  type Project,
} from "../api/projects.ts";
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
            Stored in <code>{health.data.workspace}</code>
          </p>
        )}
        {trash ? <TrashList /> : <ActiveProjects />}
      </main>
    </>
  );
}

function ActiveProjects() {
  const projects = useProjects();
  return (
    <>
      <CreateProjectForm />
      {projects.isPending && <p className="page-status">Loading projects…</p>}
      {projects.isError && <ErrorPanel error={projects.error} />}
      {projects.data?.length === 0 && (
        <p className="empty">No projects yet. Create your first one above.</p>
      )}
      {projects.data && projects.data.length > 0 && (
        <ul className="project-list" aria-label="Projects">
          {projects.data.map((p) => (
            <ProjectRow key={p.name} project={p} />
          ))}
        </ul>
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

function ProjectRow({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  const rename = useRenameProject();
  const remove = useDeleteProject();
  const duplicate = useDuplicateProject();
  const error = rename.error ?? remove.error ?? duplicate.error;

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
                { name: project.name, newName },
                {
                  onSuccess: () => {
                    setEditing(false);
                  },
                },
              );
            }}
          />
        ) : (
          <Link
            className="project-name"
            to={`/project/${encodeURIComponent(project.name)}`}
          >
            {project.name}
          </Link>
        )}
        <span className="project-meta muted">
          <span>Updated {formatDateTime(project.updatedAt)}</span>
          {project.mainFile && <span>Main file: {project.mainFile}</span>}
        </span>
        <FormError error={error} />
      </div>
      <div className="row-actions">
        {!editing && (
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
          onClick={() => {
            duplicate.mutate(project.name);
          }}
        >
          Duplicate
        </button>
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
              remove.mutate(project.name);
            }
          }}
        >
          Delete
        </button>
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
