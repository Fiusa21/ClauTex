import { useId, useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../api/client.ts";
import { useDetectTex, useHealth } from "../api/health.ts";
import { projectPage } from "../api/projects.ts";
import {
  useDocker,
  usePullImage,
  useRecentFolders,
  useRemoveFolder,
  useSettings,
  useUpdateSettings,
  type Settings,
} from "../api/settings.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { ErrorPanel } from "../components/ErrorPanel.tsx";
import { FormError } from "../components/FormError.tsx";

export function SettingsPage() {
  const settings = useSettings();
  return (
    <>
      <AppHeader />
      <main className="page settings-page">
        <p>
          <Link to="/">← Projects</Link>
        </p>
        <h1>Settings</h1>
        {settings.isPending && <p className="page-status">Loading…</p>}
        {settings.isError && <ErrorPanel error={settings.error} />}
        {settings.data && (
          <>
            <WorkspaceSection settings={settings.data} />
            <CompileSection settings={settings.data} />
            <FoldersSection />
          </>
        )}
      </main>
    </>
  );
}

function WorkspaceSection({ settings }: { settings: Settings }) {
  const [path, setPath] = useState(settings.workspace);
  const update = useUpdateSettings();
  const inputId = useId();
  return (
    <section className="settings-section" aria-labelledby={`${inputId}-h`}>
      <h2 id={`${inputId}-h`}>Workspace</h2>
      <p className="muted">
        New projects are created here; every folder in it is a project.
      </p>
      {settings.workspaceLocked ? (
        <p>
          <code>{settings.workspace}</code>
          <br />
          <span className="muted">
            Set when TexCollab was started (--workspace or TEXCOLLAB_WORKSPACE).
          </span>
        </p>
      ) : (
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ workspace: path.trim() });
          }}
        >
          <label htmlFor={inputId}>Folder</label>
          <input
            id={inputId}
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
            }}
          />
          <button
            className="button primary"
            disabled={update.isPending || path.trim() === settings.workspace}
          >
            Save
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              update.mutate({ workspace: null });
            }}
          >
            Use default
          </button>
          <FormError error={update.error} />
        </form>
      )}
    </section>
  );
}

function CompileSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [timeout, setTimeoutValue] = useState(
    String(settings.compileTimeoutSeconds),
  );
  const timeoutId = useId();
  // Local state so the radio button switches at once; saved in the background, reverted on error.
  const [mode, setMode] = useState(settings.compileMode);
  const chooseMode = (next: Settings["compileMode"]) => {
    setMode(next);
    update.mutate(
      { compileMode: next },
      {
        onError: () => {
          setMode(settings.compileMode);
        },
      },
    );
  };
  return (
    <section className="settings-section" aria-labelledby={`${timeoutId}-h`}>
      <h2 id={`${timeoutId}-h`}>Compiling</h2>
      <fieldset className="mode-choice">
        <legend>Compile with</legend>
        <label>
          <input
            type="radio"
            name="compileMode"
            checked={mode === "local"}
            onChange={() => {
              chooseMode("local");
            }}
          />{" "}
          TeX installed on this computer
        </label>
        <TexStatus />
        <label>
          <input
            type="radio"
            name="compileMode"
            checked={mode === "docker"}
            onChange={() => {
              chooseMode("docker");
            }}
          />{" "}
          Docker (TeX Live image, sandboxed)
        </label>
        <DockerStatus />
      </fieldset>
      <form
        className="settings-row"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ compileTimeoutSeconds: Number(timeout) });
        }}
      >
        <label htmlFor={timeoutId}>Timeout (seconds)</label>
        <input
          id={timeoutId}
          type="number"
          min={10}
          max={1800}
          value={timeout}
          onChange={(e) => {
            setTimeoutValue(e.target.value);
          }}
        />
        <button className="button primary" disabled={update.isPending}>
          Save
        </button>
      </form>
      <FormError error={update.error} />
    </section>
  );
}

function TexStatus() {
  const health = useHealth();
  const detect = useDetectTex();
  const tex = health.data?.tex;
  if (!tex) return null;
  return (
    <p className="status-line" data-testid="tex-status">
      {tex.available
        ? `Found: ${tex.version ?? "latexmk"}`
        : (tex.problem ?? "Not found.")}{" "}
      <button
        type="button"
        className="button ghost small"
        disabled={detect.isPending}
        onClick={() => {
          detect.mutate();
        }}
      >
        Check again
      </button>
    </p>
  );
}

function DockerStatus() {
  const docker = useDocker();
  const pull = usePullImage();
  if (docker.isPending)
    return <p className="status-line muted">Checking Docker…</p>;
  if (docker.isError)
    return (
      <p className="status-line form-error">{errorMessage(docker.error)}</p>
    );
  const d = docker.data;
  return (
    <p className="status-line" data-testid="docker-status">
      {!d.available ? (
        d.problem
      ) : d.imagePresent ? (
        `Docker ${d.version ?? ""} · TeX image ready`
      ) : d.pulling ? (
        "Downloading the TeX image (about 2.8 GB)…"
      ) : (
        <>
          Docker {d.version} · TeX image not downloaded yet.{" "}
          <button
            type="button"
            className="button ghost small"
            disabled={pull.isPending}
            onClick={() => {
              pull.mutate();
            }}
          >
            Download TeX image (≈2.8 GB)
          </button>
        </>
      )}
      {d.pullError && (
        <span className="form-error"> Download failed: {d.pullError}</span>
      )}
    </p>
  );
}

function FoldersSection() {
  const folders = useRecentFolders();
  const remove = useRemoveFolder();
  return (
    <section className="settings-section" aria-label="Opened folders">
      <h2>Opened folders</h2>
      <p className="muted">
        Folders outside the workspace you opened with “Open folder…”. Removing
        one from the list leaves it on disk.
      </p>
      {folders.data?.length === 0 && <p className="empty">None.</p>}
      <ul className="folder-list">
        {folders.data?.map((f) => (
          <li key={f.path}>
            {f.id && f.exists ? (
              <Link to={projectPage(f.id)}>{f.path}</Link>
            ) : (
              <code>{f.path}</code>
            )}
            {!f.exists && <span className="muted"> (missing)</span>}{" "}
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                remove.mutate(f.path);
              }}
            >
              Remove from list
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
