/** Thin fetch wrapper for the local server's JSON API: problem+json errors with a stable `code`. */

export class ApiError extends Error {
  readonly status: number;
  /** Stable machine-readable error code from the server (problem+json `code`). */
  readonly code: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** multipart/form-data POST (uploads). */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json" },
    body: form,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = "unknown_error";
  let detail = `Request failed (${String(res.status)}).`;
  try {
    const problem = (await res.json()) as { code?: unknown; detail?: unknown };
    if (typeof problem.code === "string") code = problem.code;
    if (typeof problem.detail === "string") detail = problem.detail;
  } catch {
    // not JSON
  }
  return new ApiError(res.status, code, detail);
}

/** A user-facing message for any error thrown by {@link api}. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Could not reach the TexCollab server. Is it still running?";
}
