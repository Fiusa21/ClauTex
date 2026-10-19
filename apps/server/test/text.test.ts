import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeText, encodeText } from "../src/text.ts";
import { call, testApp } from "./helpers.ts";

let app: FastifyInstance;
let project: string;
const text = (path: string) =>
  `/api/projects/Paper/files/text?path=${encodeURIComponent(path)}`;

beforeEach(async () => {
  let workspace: string;
  ({ app, workspace } = await testApp());
  await call(app, "POST", "/api/projects", { name: "Paper" });
  project = join(workspace, "Paper");
});

afterEach(async () => {
  await app.close();
});

interface TextFile {
  text: string;
  etag: string;
  editable: boolean;
  encoding: string;
  lineEnding: string;
  reason: string | null;
}

const read = async (path: string) =>
  (await call(app, "GET", text(path))).json<TextFile>();

describe("decodeText / encodeText", () => {
  it("round-trips CRLF and BOM", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("a\r\nb\r\n"),
    ]);
    const decoded = decodeText(bytes);
    expect(decoded).toEqual({
      text: "a\nb\n",
      utf8: true,
      bom: true,
      lineEnding: "crlf",
    });
    expect(encodeText(decoded.text, decoded)).toEqual(bytes);
  });

  it("detects non-UTF-8 bytes and renders them as Windows-1252", () => {
    const decoded = decodeText(Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65])); // "Grüße" in Latin-1
    expect(decoded).toMatchObject({ text: "Grüße", utf8: false });
  });
});

describe("GET text", () => {
  it("returns LF text with a content hash", async () => {
    const file = await read("main.tex");
    expect(file).toMatchObject({
      editable: true,
      encoding: "utf-8",
      lineEnding: "lf",
      reason: null,
    });
    expect(file.text).toContain("\\documentclass{article}");
    expect(file.etag).toMatch(/^[0-9a-f]{32}$/);
  });

  it("marks Latin-1 files read-only", async () => {
    writeFileSync(
      join(project, "old.tex"),
      Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]),
    );
    expect(await read("old.tex")).toMatchObject({
      text: "Grüße",
      editable: false,
      reason: "not_utf8",
    });
  });

  it("marks files over 2 MB read-only", async () => {
    writeFileSync(join(project, "big.tex"), "x".repeat(2 * 1024 * 1024 + 10));
    expect(await read("big.tex")).toMatchObject({
      editable: false,
      reason: "too_large",
    });
  });

  it("refuses non-text, hidden and escaping paths", async () => {
    writeFileSync(join(project, "fig.png"), "png");
    expect((await call(app, "GET", text("fig.png"))).json()).toMatchObject({
      code: "not_a_text_file",
    });
    expect((await call(app, "GET", text("../x.tex"))).json()).toMatchObject({
      code: "invalid_path",
    });
    expect(
      (await call(app, "GET", text(".texcollab.json"))).json(),
    ).toMatchObject({ code: "invalid_path" });
    expect((await call(app, "GET", text("missing.tex"))).statusCode).toBe(404);
  });
});

describe("PUT text", () => {
  it("saves when the base version matches and returns the new version", async () => {
    const { etag } = await read("main.tex");
    const res = await call(app, "PUT", text("main.tex"), {
      text: "new content\n",
      baseEtag: etag,
    });
    expect(res.statusCode).toBe(200);
    const saved = res.json<{ etag: string }>();
    expect(saved.etag).not.toBe(etag);
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(
      "new content\n",
    );
    expect((await read("main.tex")).etag).toBe(saved.etag);
  });

  it("refuses to overwrite a file changed on disk and reports its current version", async () => {
    const { etag } = await read("main.tex");
    writeFileSync(join(project, "main.tex"), "changed elsewhere\n");

    const res = await call(app, "PUT", text("main.tex"), {
      text: "mine\n",
      baseEtag: etag,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: "file_changed",
      etag: (await read("main.tex")).etag,
    });
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(
      "changed elsewhere\n",
    );
  });

  it("keeps CRLF line endings and the BOM of existing files", async () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("one\r\ntwo\r\n"),
    ]);
    writeFileSync(join(project, "win.tex"), bytes);
    const { etag, lineEnding } = await read("win.tex");
    expect(lineEnding).toBe("crlf");

    await call(app, "PUT", text("win.tex"), {
      text: "one\ntwo\nthree\n",
      baseEtag: etag,
    });

    expect(readFileSync(join(project, "win.tex"))).toEqual(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("one\r\ntwo\r\nthree\r\n"),
      ]),
    );
  });

  it("refuses non-UTF-8 files, oversized text and bad input", async () => {
    writeFileSync(join(project, "old.tex"), Buffer.from([0xfc]));
    const old = await read("old.tex");
    expect(
      (
        await call(app, "PUT", text("old.tex"), {
          text: "x",
          baseEtag: old.etag,
        })
      ).json(),
    ).toMatchObject({
      code: "not_utf8",
    });

    const { etag } = await read("main.tex");
    const big = await call(app, "PUT", text("main.tex"), {
      text: "x".repeat(2 * 1024 * 1024 + 1),
      baseEtag: etag,
    });
    expect(big.statusCode).toBe(413);
    expect(
      (await call(app, "PUT", text("main.tex"), { text: 1 })).statusCode,
    ).toBe(400);
    expect(
      (
        await call(app, "PUT", text("../main.tex"), {
          text: "x",
          baseEtag: etag,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("leaves no temporary files behind", async () => {
    const { etag } = await read("main.tex");
    await call(app, "PUT", text("main.tex"), { text: "x", baseEtag: etag });
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(project)).toEqual(["main.tex"]);
  });
});

describe("POST convert", () => {
  it("re-encodes a Latin-1 file as UTF-8 on request", async () => {
    writeFileSync(
      join(project, "old.tex"),
      Buffer.from("Gr\xfc\xdfe\r\n", "latin1"),
    );

    const res = await call(
      app,
      "POST",
      `/api/projects/Paper/files/convert?path=old.tex`,
    );

    expect(res.json()).toMatchObject({
      text: "Grüße\n",
      editable: true,
      encoding: "utf-8",
      lineEnding: "crlf",
    });
    expect(readFileSync(join(project, "old.tex"), "utf8")).toBe("Grüße\r\n");
  });
});
