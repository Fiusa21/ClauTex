import { screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { problem, renderApp, stubApi } from "../test/render.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows the workspace folder from the server", async () => {
  stubApi({
    "GET /api/health": () =>
      Response.json({
        status: "UP",
        version: "0.1.0",
        workspace: "/home/me/TexCollab",
      }),
  });
  renderApp("/");
  expect(await screen.findByTestId("workspace")).toHaveTextContent(
    "/home/me/TexCollab",
  );
});

it("explains when the server is unreachable", async () => {
  stubApi({});
  renderApp("/");
  expect(await screen.findByRole("alert")).toHaveTextContent(/server/);
});

it("shows server errors", async () => {
  stubApi({ "GET /api/health": () => problem(500, "internal_error", "Boom.") });
  renderApp("/");
  expect(await screen.findByRole("alert")).toHaveTextContent("Boom.");
});
