import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Build } from "../api/compile.ts";
import { CompilePanel } from "./CompilePanel.tsx";

const failed: Build = {
  buildId: "b1",
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
  durationMs: 1234,
  createdAt: "2026-10-19T10:00:00Z",
};

describe("CompilePanel", () => {
  it("lists errors before warnings and jumps on click", () => {
    const onJump = vi.fn();
    render(
      <CompilePanel
        projectId="p"
        build={failed}
        compiling={false}
        compileError={null}
        onJump={onJump}
      />,
    );

    expect(screen.getByTestId("compile-status")).toHaveTextContent(
      "Compile failed in 1.2 s",
    );
    const items = screen.getAllByRole("button");
    expect(items[0]).toHaveTextContent(
      "Errorchapters/intro.tex:2Undefined control sequence.",
    );
    expect(items[1]).toHaveTextContent("Warningmain.tex:4");

    fireEvent.click(items[0]);
    expect(onJump).toHaveBeenCalledWith(failed.errors[1]);
    expect(screen.getByText("No PDF was produced.")).toBeInTheDocument();
  });

  it("asks to compile when there is no build yet", () => {
    render(
      <CompilePanel
        projectId="p"
        build={undefined}
        compiling={false}
        compileError={null}
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByTestId("compile-status")).toHaveTextContent(
      "Not compiled yet",
    );
  });
});
