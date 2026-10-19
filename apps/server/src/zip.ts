import { Zip, ZipDeflate, unzip, type Unzipped } from "fflate";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { apiPath } from "./files.ts";
import { isInside, normalizeProjectName } from "./paths.ts";
import { ApiError } from "./problem.ts";
import { CONFIG_FILE, type ProjectInfo, type Workspace } from "./workspace.ts";

export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

const invalidArchive = (detail: string) =>
  new ApiError(400, "invalid_archive", detail);

/**
 * Streams a project as a ZIP: all visible files and folders plus `.texcollab.json` (so main file and compiler survive
 * a round trip). Symlinks are followed only when they stay inside the project.
 */
export function exportZip(dir: string): Readable {
  const out = new PassThrough();
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      out.destroy(err);
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });

  void (async () => {
    const root = await realpath(dir);
    const add = async (abs: string, rel: string): Promise<void> => {
      const info = await stat(abs);
      const file = new ZipDeflate(rel, { level: 6 });
      file.mtime = info.mtime;
      zip.add(file);
      for await (const chunk of createReadStream(abs)) {
        file.push(chunk as Uint8Array);
        if (out.writableNeedDrain)
          await new Promise((resolve) => out.once("drain", resolve));
      }
      file.push(new Uint8Array(0), true);
    };
    const walk = async (abs: string, rel: string): Promise<void> => {
      const entries = (await readdir(abs, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      );
      if (entries.length === 0 && rel) {
        const folder = new ZipDeflate(`${rel}/`, { level: 0 });
        zip.add(folder);
        folder.push(new Uint8Array(0), true);
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const keep =
          !entry.name.startsWith(".") ||
          (rel === "" && entry.name === CONFIG_FILE);
        if (!keep) continue;
        const childAbs = join(abs, entry.name);
        const real = await realpath(childAbs).catch(() => null);
        if (!real || !isInside(root, real)) continue;
        const info = await stat(real);
        if (info.isDirectory()) {
          if (!entry.isSymbolicLink()) await walk(childAbs, childRel);
        } else if (info.isFile()) {
          await add(real, childRel);
        }
      }
    };
    await walk(root, "");
    zip.end();
  })().catch((err: unknown) => out.destroy(err as Error));

  return out;
}

/**
 * Creates a new workspace project from a ZIP. Every entry name goes through the same path validation as the file API;
 * declared sizes are checked before anything is decompressed (zip bombs); a single top-level folder is stripped;
 * `__MACOSX` and hidden entries are skipped (except `.texcollab.json`). On any error nothing is left behind.
 */
export async function importZip(
  workspace: Workspace,
  bytes: Buffer,
  requestedName: string | undefined,
  fileName: string,
): Promise<ProjectInfo> {
  let total = 0;
  let count = 0;
  const limits = { exceeded: false };
  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      {
        filter: (file) => {
          count++;
          total += file.originalSize;
          if (count > MAX_ENTRIES || total > MAX_UNCOMPRESSED_BYTES)
            limits.exceeded = true;
          return !limits.exceeded;
        },
      },
      (err, data) => {
        if (err) reject(invalidArchive("This is not a valid ZIP file."));
        else resolve(data);
      },
    );
  });
  if (limits.exceeded) {
    throw new ApiError(
      413,
      "archive_too_large",
      "The ZIP contains too many files or more than 500 MB of data.",
    );
  }

  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>();
  for (const [rawName, data] of Object.entries(entries)) {
    const name = rawName.replace(/\\/g, "/");
    // Absolute names and ".." would escape the project folder: refuse the archive rather than repair it.
    if (
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      name.split("/").includes("..")
    ) {
      throw invalidArchive(
        `The ZIP contains a path that leads outside the project: "${rawName}".`,
      );
    }
    const segments = name.split("/").filter(Boolean);
    if (segments.length === 0 || segments.includes("__MACOSX")) continue;
    if (name.endsWith("/")) folders.add(segments.join("/"));
    else files.set(segments.join("/"), data);
  }

  // Strip one top-level folder shared by everything (typical for ZIPs of a folder or of a GitHub repository).
  const all = [...files.keys(), ...folders];
  const tops = new Set(all.map((p) => p.split("/")[0]));
  const [onlyTop] = tops;
  // Only a folder is stripped, never a lone file at the root.
  const strip =
    tops.size === 1 &&
    onlyTop !== undefined &&
    !files.has(onlyTop) &&
    all.every((p) => p.startsWith(`${onlyTop}/`) || p === onlyTop);
  const relative = (p: string) =>
    strip && onlyTop ? p.slice(onlyTop.length + 1) : p;

  const plan: { path: string; data: Uint8Array | null }[] = [];
  const check = (path: string) => {
    if (path === CONFIG_FILE) return path;
    if (path.split("/").some((s) => s.startsWith("."))) return null; // hidden: skipped
    try {
      return apiPath(path);
    } catch {
      throw invalidArchive(
        `The ZIP contains a file name TexCollab cannot use: "${path}".`,
      );
    }
  };
  for (const folder of folders) {
    const path = relative(folder);
    if (!path) continue;
    const valid = check(path);
    if (valid) plan.push({ path: valid, data: null });
  }
  for (const [file, data] of files) {
    const path = relative(file);
    if (!path) continue;
    const valid = check(path);
    if (valid) plan.push({ path: valid, data });
  }
  if (!plan.some((p) => p.data !== null))
    throw invalidArchive("The ZIP contains no files.");

  const name =
    requestedName !== undefined
      ? normalizeProjectName(requestedName)
      : await freeImportName(workspace, fileName);
  const dir = join(workspace.root, name);
  try {
    await mkdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ApiError(
        409,
        "project_exists",
        `A project named "${name}" already exists.`,
      );
    }
    throw err;
  }
  try {
    for (const { path, data } of plan.sort((a, b) =>
      a.path.localeCompare(b.path),
    )) {
      const abs = join(dir, ...path.split("/"));
      if (data === null) {
        await mkdir(abs, { recursive: true });
        continue;
      }
      await mkdir(join(abs, ".."), { recursive: true });
      try {
        await writeFile(abs, data, { flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          throw invalidArchive(
            `The ZIP contains files whose names differ only in case ("${path}").`,
          );
        }
        throw err;
      }
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return workspace.info(name);
}

async function freeImportName(
  workspace: Workspace,
  fileName: string,
): Promise<string> {
  const base =
    fileName
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.zip$/i, "")
      .replace(/[<>:"|?*\\/]/g, "-")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 100) ?? "";
  const start = base || "Imported project";
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? start : `${start} (${String(i)})`;
    try {
      const name = normalizeProjectName(candidate);
      if (!(await stat(join(workspace.root, name)).catch(() => null)))
        return name;
    } catch {
      return freeImportName(workspace, "Imported project");
    }
  }
  throw new ApiError(409, "project_exists", "Could not find a free name.");
}
