import type { FastifyReply } from "fastify";

/** Sends an RFC 7807 problem+json response with a stable `code`. */
export function sendProblem(
  reply: FastifyReply,
  status: number,
  code: string,
  detail: string,
): FastifyReply {
  return reply
    .code(status)
    .type("application/problem+json")
    .send({ type: "about:blank", status, code, detail });
}

/** An error a route throws to produce a problem response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
