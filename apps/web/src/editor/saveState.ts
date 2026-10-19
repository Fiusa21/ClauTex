/** What the editor shows about the open file's state on disk. */
export type SaveState =
  | { kind: "loading" }
  | { kind: "saved" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "conflict" }
  | { kind: "deleted" }
  | { kind: "readonly"; reason: "not_utf8" | "too_large" }
  | { kind: "error"; message: string };

export const SAVE_LABELS: Record<SaveState["kind"], string> = {
  loading: "Loading…",
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  conflict: "Changed on disk",
  deleted: "Deleted on disk",
  readonly: "Read-only",
  error: "Save failed",
};

/** True while closing the page would lose edits. */
export const hasPendingEdits = (state: SaveState) =>
  state.kind === "unsaved" ||
  state.kind === "saving" ||
  state.kind === "conflict" ||
  state.kind === "error";
