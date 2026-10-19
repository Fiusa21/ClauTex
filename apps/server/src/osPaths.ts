import { homedir } from "node:os";
import { join } from "node:path";

/** Per-user folders for app settings and caches, following each OS's conventions (SPEC §3). */

export function defaultConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  if (platform === "win32")
    return join(
      env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "TexCollab",
    );
  if (platform === "darwin")
    return join(homedir(), "Library", "Application Support", "TexCollab");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "texcollab");
}

export function defaultCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  if (platform === "win32") {
    return join(
      env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "TexCollab",
      "Cache",
    );
  }
  if (platform === "darwin")
    return join(homedir(), "Library", "Caches", "TexCollab");
  return join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "texcollab");
}
