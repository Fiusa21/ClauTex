import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, parse } from "node:path";
import { isInside } from "./paths.ts";
import { ApiError } from "./problem.ts";

/**
 * Validates a folder the user wants to open from outside the workspace (L4). Returns its real path.
 * Refuses the file-system root and the home folder (far too broad to treat as a LaTeX project) and folders inside the
 * workspace (those are ordinary projects already).
 */
export async function checkOpenableFolder(
  raw: unknown,
  workspaceRoot: string,
): Promise<string> {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ApiError(
      400,
      "validation_failed",
      "Enter the full path of a folder.",
    );
  }
  const input = raw.trim();
  if (!isAbsolute(input)) {
    throw new ApiError(
      400,
      "invalid_folder",
      "Enter a full (absolute) path, e.g. /Users/me/thesis or C:\\Users\\me\\thesis.",
    );
  }
  const real = await realpath(input).catch(() => null);
  if (!real || !(await stat(real)).isDirectory()) {
    throw new ApiError(404, "folder_not_found", "This folder does not exist.");
  }
  const home = await realpath(homedir()).catch(() => homedir());
  if (real === parse(real).root || real === home) {
    throw new ApiError(
      400,
      "invalid_folder",
      "Choose the folder of a LaTeX project, not your whole drive or home folder.",
    );
  }
  const workspace = await realpath(workspaceRoot).catch(() => workspaceRoot);
  if (isInside(workspace, real) || isInside(real, workspace)) {
    throw new ApiError(
      409,
      "inside_workspace",
      "This folder is the workspace or inside it (or contains it). Open it from the project list instead.",
    );
  }
  return real;
}
