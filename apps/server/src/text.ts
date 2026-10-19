import { createHash } from "node:crypto";

/** Reading and writing editable text files without changing what the user did not edit (SPEC §3). */

export type LineEnding = "lf" | "crlf";

export interface DecodedText {
  /** Content with LF line endings, without BOM. */
  text: string;
  /** False when the bytes are not valid UTF-8; `text` is then a Windows-1252 rendering for display only. */
  utf8: boolean;
  bom: boolean;
  lineEnding: LineEnding;
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Version tag for conflict detection: a hash of the exact bytes on disk (mtime is too coarse). */
export function etagOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

export function decodeText(bytes: Buffer): DecodedText {
  const bom = bytes.subarray(0, 3).equals(BOM);
  const body = bom ? bytes.subarray(3) : bytes;
  let text: string;
  let utf8 = true;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    text = new TextDecoder("windows-1252").decode(body);
    utf8 = false;
  }
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return {
    text: text.replace(/\r\n?/g, "\n"),
    utf8,
    bom,
    lineEnding: crlf > lf ? "crlf" : "lf",
  };
}

/** Encodes editor text (LF) back to bytes in the file's original style. */
export function encodeText(
  text: string,
  style: { bom: boolean; lineEnding: LineEnding },
): Buffer {
  const normalized = text.replace(/\r\n?/g, "\n");
  const body = Buffer.from(
    style.lineEnding === "crlf"
      ? normalized.replace(/\n/g, "\r\n")
      : normalized,
    "utf8",
  );
  return style.bom ? Buffer.concat([BOM, body]) : body;
}
