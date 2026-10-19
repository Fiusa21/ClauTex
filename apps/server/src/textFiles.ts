/** Which files are editable text, and the content types used to serve files (SPEC §3). */

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "tex",
  "bib",
  "sty",
  "cls",
  "txt",
  "md",
  "bst",
  "cfg",
  "def",
  "dtx",
  "ins",
  "csv",
  "tikz",
  "lua",
]);
const TEXT_NAMES = new Set([".latexmkrc"]);

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  eps: "application/postscript",
};

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isTextPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return TEXT_NAMES.has(name) || TEXT_EXTENSIONS.has(extension(path));
}

/** From the extension only; never from the client. */
export function contentType(path: string): string {
  if (isTextPath(path)) return "text/plain; charset=utf-8";
  return CONTENT_TYPES[extension(path)] ?? "application/octet-stream";
}

export function isImage(path: string): boolean {
  return contentType(path).startsWith("image/");
}
