import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Build } from "../api/compile.ts";
import type { TexInfo } from "../api/health.ts";
import { CompilePanel } from "./CompilePanel.tsx";

const tex: TexInfo = {
  available: true,
  version: "Latexmk 4.88",
  engines: { pdflatex: true, xelatex: true, lualatex: true },
  problem: null,
};

const failed: Build = {
  status: "failure",
  errors: [
    { level: "warning", file: "main.tex", line: 4, message: "Overfull \\hbox" },
    {
      level: "error",
      file: "chapters/intro.tex",
      line: 2,
      message: "Undefined control sequence.",
    },
  ],
  logExcerpt: "…",
  pdfUrl: null,
  pdfIsFresh: false,
  durationMs: 1234,
  createdAt: "2026-10-19T10:00:00Z",
};

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe("CompilePanel", () => {
  it("lists errors before warnings and jumps on click", () => {
    const onJump = vi.fn();
    wrap(
      <CompilePanel
        project="p"
        build={failed}
        tex={tex}
        compiling={false}
        compileError={null}
        onJump={onJump}
      />,
    );

    expect(screen.getByTestId("compile-status")).toHaveTextContent(
      "Compile failed in 1.2 s",
    );
    const [first, second] = screen.getAllByRole("button");
    expect(first).toHaveTextContent(
      "Errorchapters/intro.tex:2Undefined control sequence.",
    );
    expect(second).toHaveTextContent("Warningmain.tex:4");
    fireEvent.click(first);
    expect(onJump).toHaveBeenCalledWith(failed.errors[1]);
    expect(screen.getByText("No PDF was produced.")).toBeInTheDocument();
  });

  it("says when it shows an older PDF", () => {
    wrap(
      <CompilePanel
        project="p"
        build={{ ...failed, pdfUrl: "/api/projects/p/output.pdf?v=1" }}
        tex={tex}
        compiling={false}
        compileError={null}
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByTestId("stale-pdf")).toHaveTextContent(
      "last successful PDF",
    );
  });

  it("shows setup instructions when TeX is missing", () => {
    wrap(
      <CompilePanel
        project="p"
        build={null}
        tex={{
          ...tex,
          available: false,
          problem: "latexmk was not found on PATH.",
        }}
        compiling={false}
        compileError={null}
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tex-setup")).toHaveTextContent(
      "latexmk was not found on PATH.",
    );
    expect(screen.getByRole("button", { name: "Check again" })).toBeVisible();
  });
});
