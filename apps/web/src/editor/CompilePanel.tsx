import { lazy, Suspense } from "react";
import { logUrl, type Build, type CompileIssue } from "../api/compile.ts";
import { errorMessage } from "../api/client.ts";
import type { TexInfo } from "../api/health.ts";
import { TexSetup } from "./TexSetup.tsx";

// pdf.js is large; load it only when there is a PDF to show.
const PdfViewer = lazy(async () => ({
  default: (await import("./PdfViewer.tsx")).PdfViewer,
}));

const STATUS_TEXT: Record<Build["status"], string> = {
  success: "Compiled",
  failure: "Compile failed",
  timeout: "Compile timed out",
  error: "Compile error",
};

interface Props {
  project: string;
  build: Build | null | undefined;
  tex: TexInfo | undefined;
  compiling: boolean;
  compileError: unknown;
  onJump: (issue: CompileIssue) => void;
}

/** PDF of the last successful build plus the errors and warnings of the latest one. */
export function CompilePanel({
  project,
  build,
  tex,
  compiling,
  compileError,
  onJump,
}: Props) {
  if (tex && !tex.available) {
    return (
      <section className="compile-panel" aria-label="PDF preview">
        <TexSetup tex={tex} />
      </section>
    );
  }
  const errors = build?.errors.filter((e) => e.level === "error") ?? [];
  const warnings = build?.errors.filter((e) => e.level === "warning") ?? [];
  const stalePdf = build?.pdfUrl && !build.pdfIsFresh;

  return (
    <section className="compile-panel" aria-label="PDF preview">
      <div
        className="compile-status"
        role="status"
        data-testid="compile-status"
      >
        {compiling
          ? "Compiling…"
          : compileError
            ? errorMessage(compileError)
            : build
              ? `${STATUS_TEXT[build.status]} in ${(build.durationMs / 1000).toFixed(1)} s`
              : "Not compiled yet. Press Compile (Ctrl/⌘ + S)."}
        {build && (
          <a
            className="muted log-link"
            href={logUrl(project)}
            target="_blank"
            rel="noreferrer"
          >
            Log
          </a>
        )}
      </div>
      {(errors.length > 0 ||
        warnings.length > 0 ||
        (build && build.status !== "success")) && (
        <div className="issues" data-testid="issues">
          {build && build.status !== "success" && errors.length === 0 && (
            <pre className="log-excerpt">{build.logExcerpt}</pre>
          )}
          <ul aria-label="Compile errors and warnings">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`issue issue-${issue.level}`}
                  onClick={() => {
                    onJump(issue);
                  }}
                >
                  <span className="issue-level">
                    {issue.level === "error" ? "Error" : "Warning"}
                  </span>
                  <span className="issue-where">
                    {issue.file ?? "?"}
                    {issue.line !== null ? `:${String(issue.line)}` : ""}
                  </span>
                  <span className="issue-message">{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {stalePdf && (
        <p className="stale-note muted" data-testid="stale-pdf">
          Showing the last successful PDF.
        </p>
      )}
      {build?.pdfUrl ? (
        <Suspense
          fallback={
            <p className="page-status pdf-empty">Loading PDF viewer…</p>
          }
        >
          <PdfViewer url={build.pdfUrl} />
        </Suspense>
      ) : (
        <p className="page-status pdf-empty">
          {build ? "No PDF was produced." : ""}
        </p>
      )}
    </section>
  );
}
