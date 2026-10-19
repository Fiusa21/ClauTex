import { screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderApp, stubApi } from "../test/render.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

const health = () =>
  Response.json({
    status: "UP",
    version: "0.1.0",
    workspace: "/home/me/Documents/TexCollab",
  });

it("lists projects with links and shows where they are stored", async () => {
  stubApi({
    "GET /api/health": health,
    "GET /api/projects": () =>
      Response.json([
        {
          id: "Thesis & Co",
          name: "Thesis & Co",
          external: false,
          path: null,
          mainFile: "main.tex",
          compiler: "pdflatex",
          updatedAt: "2026-10-19T10:00:00Z",
        },
      ]),
  });
  renderApp("/");

  const [row] = await screen.findAllByTestId("project-row");
  expect(
    within(row).getByRole("link", { name: "Thesis & Co" }),
  ).toHaveAttribute("href", "/project/Thesis%20%26%20Co");
  expect(await screen.findByTestId("workspace")).toHaveTextContent(
    "/home/me/Documents/TexCollab",
  );
});

it("shows the trash", async () => {
  stubApi({
    "GET /api/health": health,
    "GET /api/trash": () =>
      Response.json([
        {
          entry: "Old~20261019T100000Z",
          name: "Old",
          deletedAt: "2026-10-19T10:00:00Z",
        },
      ]),
  });
  renderApp("/?view=trash");
  const [row] = await screen.findAllByTestId("trash-row");
  expect(within(row).getByRole("button", { name: "Restore" })).toBeVisible();
});
