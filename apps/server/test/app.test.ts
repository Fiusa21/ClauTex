import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { HOST, PORT, testApp } from "./helpers.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe("GET /api/health", () => {
  it("reports status, version and workspace", async () => {
    const t = await testApp();
    app = t.app;
    const res = await app.inject({
      url: "/api/health",
      headers: { host: HOST },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "UP",
      version: "0.1.0",
      workspace: t.workspace,
      tex: { available: true, version: "Latexmk (fake) Version 0" },
    });
  });
});

describe("Host check (DNS rebinding)", () => {
  it.each([
    `localhost:${String(PORT)}`,
    `127.0.0.1:${String(PORT)}`,
    `[::1]:${String(PORT)}`,
    `LOCALHOST:${String(PORT)}`,
  ])("accepts %s", async (host) => {
    app = (await testApp()).app;
    const res = await app.inject({ url: "/api/health", headers: { host } });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    "evil.example",
    `evil.example:${String(PORT)}`,
    "localhost:9999",
    "localhost",
    "127.0.0.1",
  ])("rejects %s, also for the web app", async (host) => {
    app = (await testApp()).app;
    for (const url of ["/api/health", "/", "/assets/app-abc123.js"]) {
      const res = await app.inject({ url, headers: { host } });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "host_not_allowed" });
    }
  });
});

describe("Origin check (other websites)", () => {
  it("rejects a foreign Origin on any API method", async () => {
    app = (await testApp()).app;
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url: "/api/health",
        headers: { host: HOST, origin: "https://evil.example" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "origin_not_allowed" });
    }
  });

  it("rejects other local apps (same site, other port)", async () => {
    app = (await testApp()).app;
    const res = await app.inject({
      url: "/api/health",
      headers: {
        host: HOST,
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-site",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects Sec-Fetch-Site: cross-site even without Origin", async () => {
    app = (await testApp()).app;
    const res = await app.inject({
      url: "/api/health",
      headers: { host: HOST, "sec-fetch-site": "cross-site" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts its own origin and requests without Origin (e.g. curl)", async () => {
    app = (await testApp()).app;
    const own = await app.inject({
      method: "POST",
      url: "/api/health",
      headers: {
        host: HOST,
        origin: `http://localhost:${String(PORT)}`,
        "sec-fetch-site": "same-origin",
      },
    });
    expect(own.statusCode).not.toBe(403);
    const plain = await app.inject({
      url: "/api/health",
      headers: { host: HOST },
    });
    expect(plain.statusCode).toBe(200);
  });

  it("accepts the Vite dev server only in dev mode", async () => {
    app = (await testApp()).app;
    const headers = { host: HOST, origin: "http://localhost:5173" };
    expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
      403,
    );
    await app.close();

    app = (await testApp({ devOrigins: ["http://localhost:5173"] })).app;
    expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
      200,
    );
  });

  it("allows navigation to the web app from other sites (links)", async () => {
    app = (await testApp()).app;
    const res = await app.inject({
      url: "/",
      headers: { host: HOST, "sec-fetch-site": "cross-site" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("never sends CORS headers", async () => {
    app = (await testApp()).app;
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/health",
      headers: {
        host: HOST,
        origin: `http://localhost:${String(PORT)}`,
        "access-control-request-method": "PUT",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("web app", () => {
  it("serves index.html and immutable hashed assets", async () => {
    app = (await testApp()).app;
    const index = await app.inject({ url: "/", headers: { host: HOST } });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain("<title>TexCollab</title>");
    expect(index.headers["cache-control"]).toBe("no-cache");

    const asset = await app.inject({
      url: "/assets/app-abc123.js",
      headers: { host: HOST },
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
  });

  it("falls back to index.html for client-side routes", async () => {
    app = (await testApp()).app;
    const res = await app.inject({
      url: "/project/thesis?file=main.tex",
      headers: { host: HOST },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<title>TexCollab</title>");
  });

  it("returns problem+json 404 for unknown API routes", async () => {
    app = (await testApp()).app;
    const res = await app.inject({ url: "/api/nope", headers: { host: HOST } });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ code: "not_found" });
  });

  it("does not serve files outside the web app", async () => {
    app = (await testApp()).app;
    for (const url of [
      "/../package.json",
      "/%2e%2e/package.json",
      "/assets/..%2f..%2fworkspace",
    ]) {
      const res = await app.inject({ url, headers: { host: HOST } });
      expect(res.body).not.toContain('"name"');
    }
  });

  it("explains when the web app is not built", async () => {
    app = (await testApp({ webDist: "/nonexistent" })).app;
    const res = await app.inject({ url: "/", headers: { host: HOST } });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("npm start");
  });
});
