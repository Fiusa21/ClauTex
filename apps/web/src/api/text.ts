import { ApiError, api } from "./client.ts";
import { projectUrl } from "./projects.ts";

export interface TextFile {
  path: string;
  text: string;
  etag: string;
  editable: boolean;
  encoding: "utf-8" | "windows-1252";
  lineEnding: "lf" | "crlf";
  reason: "not_utf8" | "too_large" | null;
}

const url = (project: string, kind: "text" | "convert", path: string) =>
  `${projectUrl(project)}/files/${kind}?path=${encodeURIComponent(path)}`;

export const fetchText = (project: string, path: string) =>
  api<TextFile>("GET", url(project, "text", path));

export const convertToUtf8 = (project: string, path: string) =>
  api<TextFile>("POST", url(project, "convert", path));

export type SaveResult =
  { ok: true; etag: string } | { ok: false; conflictEtag: string };

/**
 * Saves text if the file on disk is still `baseEtag`; reports a conflict otherwise. `keepalive` lets a save started
 * while the page is closing finish.
 */
export async function saveText(
  project: string,
  path: string,
  text: string,
  baseEtag: string,
  keepalive = false,
): Promise<SaveResult> {
  const res = await fetch(url(project, "text", path), {
    method: "PUT",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ text, baseEtag }),
    keepalive,
  });
  const body = (await res.json()) as {
    etag?: string;
    code?: string;
    detail?: string;
  };
  if (res.ok && body.etag) return { ok: true, etag: body.etag };
  if (res.status === 409 && body.code === "file_changed" && body.etag) {
    return { ok: false, conflictEtag: body.etag };
  }
  throw new ApiError(
    res.status,
    body.code ?? "save_failed",
    body.detail ?? "Saving failed.",
  );
}
