import type { FastifyReply } from "fastify";

/** Sends an RFC 7807 problem+json response with a stable `code` (plus optional extra fields). */
export function sendProblem(
  reply: FastifyReply,
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
): FastifyReply {
  return reply
    .code(status)
    .type("application/problem+json")
    .send({ type: "about:blank", status, code, detail, ...extra });
}

/** An error a route throws to produce a problem response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    detail: string,
    extra: Record<string, unknown> = {},
  ) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
