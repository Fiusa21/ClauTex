import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "./helpers.ts";

let app: FastifyInstance;
let project: string;
let base: string;

/** A free local port, so the Host guard and the listener agree on it. */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

let port: number;

beforeEach(async () => {
  port = await freePort();
  let workspace: string;
  ({ app, workspace } = await testApp({ port }));
  await app.listen({ host: "127.0.0.1", port });
  base = `http://127.0.0.1:${String(port)}`;
  project = join(workspace, "Paper");
  mkdirSync(project);
});

afterEach(async () => {
  await app.close();
});

/** Reads server-sent events until `predicate` matches one, then closes the stream. */
async function nextEvent(
  url: string,
  host: string,
  trigger: () => void,
  predicate: (event: string, data: unknown) => boolean,
): Promise<{ event: string; data: unknown }> {
  const controller = new AbortController();
  const res = await fetch(url, {
    headers: { host },
    signal: controller.signal,
  });
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  let buffer = "";
  let triggered = false;
  const deadline = Date.now() + 5000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = (await reader.read()) as {
        value?: Uint8Array;
        done: boolean;
      };
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
        const data = JSON.parse(
          /^data: (.*)$/m.exec(block)?.[1] ?? "null",
        ) as unknown;
        if (event === "ready" && !triggered) {
          triggered = true;
          trigger();
        } else if (predicate(event, data)) {
          return { event, data };
        }
      }
    }
    throw new Error("no matching event");
  } finally {
    controller.abort();
  }
}

describe("GET events", () => {
  it("reports files changed by other programs as project paths", async () => {
    const result = await nextEvent(
      `${base}/api/projects/Paper/events`,
      `localhost:${String(port)}`,
      () => {
        mkdirSync(join(project, "chapters"), { recursive: true });
        writeFileSync(join(project, "chapters", "intro.tex"), "external");
      },
      (event, data) =>
        event === "change" &&
        (data as { paths: string[] }).paths.includes("chapters/intro.tex"),
    );
    expect(result.event).toBe("change");
  });

  it("does not report hidden files", async () => {
    // Collect every batch until the visible file shows up; none may mention the hidden one.
    // (macOS may also report the just-created project folder itself; that is harmless.)
    const batches: string[][] = [];
    await nextEvent(
      `${base}/api/projects/Paper/events`,
      `localhost:${String(port)}`,
      () => {
        writeFileSync(join(project, ".hidden"), "x");
        setTimeout(() => {
          writeFileSync(join(project, "visible.tex"), "x");
        }, 300);
      },
      (event, data) => {
        if (event !== "change") return false;
        const { paths } = data as { paths: string[] };
        batches.push(paths);
        return paths.includes("visible.tex");
      },
    );
    expect(batches.flat()).not.toContain(".hidden");
    expect(batches.flat()).toContain("visible.tex");
  });
});
