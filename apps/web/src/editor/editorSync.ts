import { errorMessage } from "../api/client.ts";
import {
  fetchText,
  saveText,
  type SaveResult,
  type TextFile,
} from "../api/text.ts";
import type { SaveState } from "./saveState.ts";

export const AUTOSAVE_DELAY_MS = 1000;

export interface SyncApi {
  saveText: (
    project: string,
    path: string,
    text: string,
    baseEtag: string,
    keepalive?: boolean,
  ) => Promise<SaveResult>;
  fetchText: (project: string, path: string) => Promise<TextFile>;
}

export interface SyncHost {
  /** Current editor text. */
  getText: () => string;
  /** Replaces the editor text with the version from disk (must not count as an edit). */
  applyFromDisk: (text: string) => void;
  onState: (state: SaveState) => void;
  onConflict: (conflict: boolean) => void;
}

/**
 * Keeps one open file in sync with disk: debounced autosave, one save at a time, and conflict detection against
 * changes made by other programs using the server's content-hash ETags. Framework-free so it can be tested directly.
 */
export class EditorSync {
  private baseEtag: string;
  private savedText: string;
  private saving: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private conflictEtag: string | null = null;
  private disposed = false;

  private readonly project: string;
  private readonly path: string;
  private readonly host: SyncHost;
  private readonly api: SyncApi;

  constructor(
    project: string,
    path: string,
    loaded: TextFile,
    host: SyncHost,
    api: SyncApi = { saveText, fetchText },
  ) {
    this.project = project;
    this.path = path;
    this.host = host;
    this.api = api;
    this.baseEtag = loaded.etag;
    this.savedText = loaded.text;
  }

  get dirty(): boolean {
    return this.host.getText() !== this.savedText;
  }

  /** The user typed. */
  edited(): void {
    if (this.conflictEtag) return; // stays "changed on disk" until the user decides
    this.host.onState({ kind: "unsaved" });
    this.schedule();
  }

  /**
   * Writes the text if it differs from disk. `text` is a snapshot taken by the caller (needed when the editor is
   * about to be destroyed); `force` overwrites a conflicting version on disk.
   */
  async save(
    opts: { force?: boolean; keepalive?: boolean; text?: string } = {},
  ): Promise<void> {
    this.clearTimer();
    const text = opts.text ?? this.host.getText();
    if (this.saving) await this.saving;
    if (this.disposed && !opts.keepalive) return;
    if (text === this.savedText && !opts.force) return;
    if (this.conflictEtag && !opts.force) return;

    const base =
      opts.force && this.conflictEtag ? this.conflictEtag : this.baseEtag;
    this.report({ kind: "saving" });
    this.saving = (async () => {
      try {
        const result = await this.api.saveText(
          this.project,
          this.path,
          text,
          base,
          opts.keepalive,
        );
        if (result.ok) {
          this.baseEtag = result.etag;
          this.savedText = text;
          this.setConflict(null);
          if (this.disposed) return;
          if (this.dirty) {
            this.report({ kind: "unsaved" });
            this.schedule();
          } else {
            this.report({ kind: "saved" });
          }
        } else {
          this.setConflict(result.conflictEtag);
          this.report({ kind: "conflict" });
        }
      } catch (err) {
        this.report({ kind: "error", message: errorMessage(err) });
      } finally {
        this.saving = null;
      }
    })();
    await this.saving;
  }

  /** Another program changed the file. Reload silently if there are no edits; otherwise ask the user. */
  async diskChanged(): Promise<void> {
    if (this.saving) await this.saving;
    let loaded: TextFile;
    try {
      loaded = await this.api.fetchText(this.project, this.path);
    } catch {
      this.report({ kind: "deleted" });
      return;
    }
    if (this.disposed || loaded.etag === this.baseEtag) return; // e.g. our own save
    if (this.dirty) {
      this.setConflict(loaded.etag);
      this.report({ kind: "conflict" });
    } else {
      this.adopt(loaded);
    }
  }

  /** Conflict resolution: discard local edits and take the file from disk. */
  async loadFromDisk(): Promise<void> {
    try {
      this.adopt(await this.api.fetchText(this.project, this.path));
    } catch (err) {
      this.report({ kind: "error", message: errorMessage(err) });
    }
  }

  /** Conflict resolution: overwrite the version on disk with the editor's text. */
  keepMine(): Promise<void> {
    return this.save({ force: true });
  }

  /** The editor goes away (other file, page closed): write pending edits unless the user must decide first. */
  dispose(): void {
    const text = this.host.getText();
    const pending = text !== this.savedText && !this.conflictEtag;
    this.disposed = true;
    if (pending) void this.save({ keepalive: true, text });
    else this.clearTimer();
  }

  private adopt(loaded: TextFile): void {
    this.baseEtag = loaded.etag;
    this.savedText = loaded.text;
    this.setConflict(null);
    if (this.host.getText() !== loaded.text)
      this.host.applyFromDisk(loaded.text);
    this.report({ kind: "saved" });
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setConflict(etag: string | null): void {
    this.conflictEtag = etag;
    if (!this.disposed) this.host.onConflict(etag !== null);
  }

  private report(state: SaveState): void {
    if (!this.disposed) this.host.onState(state);
  }
}
