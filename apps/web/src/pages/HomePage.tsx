import { useHealth } from "../api/health.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { ErrorPanel } from "../components/ErrorPanel.tsx";

/** Start page. Shows where projects are stored; becomes the project list in L1. */
export function HomePage() {
  const health = useHealth();

  return (
    <>
      <AppHeader />
      <main className="page">
        <h1>Projects</h1>
        {health.isPending && (
          <p className="page-status">Connecting to the local server…</p>
        )}
        {health.isError && <ErrorPanel error={health.error} />}
        {health.data && (
          <p className="muted" data-testid="workspace">
            Workspace: <code>{health.data.workspace}</code>
          </p>
        )}
      </main>
    </>
  );
}
