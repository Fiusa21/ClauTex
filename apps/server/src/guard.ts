import type { FastifyReply, FastifyRequest } from "fastify";
import { sendProblem } from "./problem.ts";

/**
 * Protects the local server from other websites in the user's browser (SPEC §5):
 * - Host must be this server (defeats DNS rebinding) — checked for every request.
 * - For /api: a foreign Origin, or Sec-Fetch-Site: cross-site, is rejected.
 * No CORS headers are ever sent, so cross-origin reads stay blocked by the browser.
 */
export function createGuard(port: number, extraOrigins: string[] = []) {
  const hosts = new Set([
    `localhost:${String(port)}`,
    `127.0.0.1:${String(port)}`,
    `[::1]:${String(port)}`,
  ]);
  const origins = new Set([
    ...[...hosts].map((h) => `http://${h}`),
    ...extraOrigins,
  ]);

  return async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const host = request.headers.host?.toLowerCase();
    if (!host || !hosts.has(host)) {
      await sendProblem(
        reply,
        403,
        "host_not_allowed",
        "Requests must be addressed to localhost.",
      );
      return;
    }
    if (!request.url.startsWith("/api/")) return;

    const origin = request.headers.origin;
    if (origin !== undefined && !origins.has(origin.toLowerCase())) {
      await sendProblem(
        reply,
        403,
        "origin_not_allowed",
        "Requests from other websites are not allowed.",
      );
      return;
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      await sendProblem(
        reply,
        403,
        "origin_not_allowed",
        "Requests from other websites are not allowed.",
      );
    }
  };
}
