import { watch, type FSWatcher } from "node:fs";
import { sep } from "node:path";

export type ChangeListener = (paths: string[]) => void;

interface Entry {
  watcher: FSWatcher | null;
  listeners: Set<ChangeListener>;
  pending: Set<string>;
  timer: NodeJS.Timeout | null;
}

/**
 * One recursive file watcher per project folder, shared by all subscribers (SSE connections). Changes are batched
 * for 150 ms and reported as project-relative "/" paths; hidden entries (and our temporary files) are skipped.
 * Recursive `fs.watch` is native on macOS and Windows and supported on Linux since Node 20.
 */
export class ProjectWatcher {
  private readonly entries = new Map<string, Entry>();

  subscribe(
    dir: string,
    listener: ChangeListener,
    onError: (err: Error) => void,
  ): () => void {
    let entry = this.entries.get(dir);
    if (!entry) {
      const created: Entry = {
        watcher: null,
        listeners: new Set(),
        pending: new Set(),
        timer: null,
      };
      try {
        created.watcher = watch(
          dir,
          { recursive: true },
          (_event, filename) => {
            if (filename) this.queue(created, filename);
          },
        );
        created.watcher.on("error", (err) => {
          onError(err);
          this.close(dir);
        });
      } catch (err) {
        onError(err as Error);
      }
      entry = created;
      this.entries.set(dir, entry);
    }
    entry.listeners.add(listener);
    const current = entry;
    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size === 0) this.close(dir);
    };
  }

  closeAll(): void {
    for (const dir of [...this.entries.keys()]) this.close(dir);
  }

  private queue(entry: Entry, filename: string): void {
    const path = filename.split(sep).join("/");
    if (path.split("/").some((segment) => segment.startsWith("."))) return;
    entry.pending.add(path);
    entry.timer ??= setTimeout(() => {
      entry.timer = null;
      const paths = [...entry.pending].sort();
      entry.pending.clear();
      for (const listener of entry.listeners) listener(paths);
    }, 150);
  }

  private close(dir: string): void {
    const entry = this.entries.get(dir);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher?.close();
    this.entries.delete(dir);
  }
}
