import { errorMessage } from "../api/client.ts";
import { useDetectTex, type TexInfo } from "../api/health.ts";

type Os = "windows" | "macos" | "linux";

function detectOs(): Os {
  const platform = navigator.userAgent.toLowerCase();
  if (platform.includes("windows")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
}

const INSTRUCTIONS: Record<Os, { title: string; steps: React.ReactNode[] }> = {
  windows: {
    title: "Windows",
    steps: [
      <>
        Install <a href="https://tug.org/texlive/windows.html">TeX Live</a>{" "}
        (includes latexmk and Perl) or{" "}
        <a href="https://miktex.org/download">MiKTeX</a> (installs Perl and
        packages on demand).
      </>,
      "Restart TexCollab so it sees the new PATH.",
    ],
  },
  macos: {
    title: "macOS",
    steps: [
      <>
        Install <a href="https://tug.org/mactex/">MacTeX</a>, or with Homebrew:{" "}
        <code>brew install --cask mactex-no-gui</code>.
      </>,
      <>
        Make sure <code>/Library/TeX/texbin</code> is on your PATH, then restart
        TexCollab.
      </>,
    ],
  },
  linux: {
    title: "Linux",
    steps: [
      <>
        Debian/Ubuntu: <code>sudo apt install texlive-full latexmk</code> (or a
        smaller set such as <code>texlive-latex-extra latexmk</code>).
      </>,
      <>
        Fedora: <code>sudo dnf install texlive-scheme-full latexmk</code>.
      </>,
    ],
  },
};

/** Shown instead of the PDF when no TeX installation was found. */
export function TexSetup({ tex }: { tex: TexInfo }) {
  const detect = useDetectTex();
  const os = INSTRUCTIONS[detectOs()];
  return (
    <div className="tex-setup" data-testid="tex-setup">
      <h2>Install TeX to compile</h2>
      <p className="muted">{tex.problem ?? "No TeX installation was found."}</p>
      <h3>{os.title}</h3>
      <ol>
        {os.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <button
        type="button"
        className="button primary"
        disabled={detect.isPending}
        onClick={() => {
          detect.mutate();
        }}
      >
        {detect.isPending ? "Checking…" : "Check again"}
      </button>
      {detect.isError && (
        <p className="form-error">{errorMessage(detect.error)}</p>
      )}
      {detect.data && !detect.data.available && (
        <p className="form-error">Still not found: {detect.data.problem}</p>
      )}
    </div>
  );
}
