import { afterEach, describe, expect, it, vi } from "vitest";
import { problem, stubApi } from "../test/render.tsx";
import { api, ApiError, errorMessage } from "./client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api()", () => {
  it("sends JSON and parses the response", async () => {
    const calls = stubApi({
      "POST /api/projects": () => Response.json({ name: "p" }, { status: 201 }),
    });

    await expect(api("POST", "/api/projects", { name: "p" })).resolves.toEqual({
      name: "p",
    });
    const init = calls[0]?.init;
    expect(init?.body).toBe('{"name":"p"}');
    expect((init?.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
  });

  it("turns problem+json into ApiError with code", async () => {
    stubApi({
      "GET /api/projects/x": () =>
        problem(404, "project_not_found", "Project not found."),
    });
    const err: unknown = await api("GET", "/api/projects/x").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "project_not_found" });
  });

  it("returns undefined for 204", async () => {
    stubApi({ "DELETE /api/x": () => new Response(null, { status: 204 }) });
    await expect(api("DELETE", "/api/x")).resolves.toBeUndefined();
  });
});

describe("errorMessage()", () => {
  it("uses the server's detail", () => {
    expect(errorMessage(new ApiError(409, "path_exists", "Exists."))).toBe(
      "Exists.",
    );
  });

  it("explains network errors", () => {
    expect(errorMessage(new TypeError("fetch failed"))).toMatch(/server/);
  });
});
