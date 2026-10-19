import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Annotation, EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { errorMessage } from "../api/client.ts";
import { convertToUtf8, fetchText, type TextFile } from "../api/text.ts";
import { EditorSync } from "./editorSync.ts";
import { latexCompletions, latexLanguage } from "./latex.ts";
import type { SaveState } from "./saveState.ts";
import { editorHighlighting, editorTheme } from "./theme.ts";

/** Marks changes that came from disk, so they are not treated as edits. */
const fromDisk = Annotation.define<boolean>();

/** Request to move the cursor to a line; a new `seq` repeats the jump. */
export interface Jump {
  line: number;
  seq: number;
}

/** Paths changed on disk, with a sequence number so repeated changes are noticed. */
export interface DiskChange {
  paths: string[];
  seq: number;
}

export interface EditorHandle {
  /** Saves pending edits now (Ctrl/⌘+S, before switching files or compiling). */
  saveNow: () => Promise<void>;
}

interface Props {
  project: string;
  path: string;
  diskChange: DiskChange | null;
  jump?: Jump | undefined;
  onState: (state: SaveState) => void;
  ref?: Ref<EditorHandle>;
}

/** CodeMirror on one file of a local project; saving and conflict handling live in {@link EditorSync}. */
export function LocalEditor({
  project,
  path,
  diskChange,
  jump,
  onState,
  ref,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const sync = useRef<EditorSync | null>(null);
  const onStateRef = useRef(onState);
  const [file, setFile] = useState<TextFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useLayoutEffect(() => {
    onStateRef.current = onState;
  });

  useImperativeHandle(
    ref,
    () => ({ saveNow: () => sync.current?.save() ?? Promise.resolve() }),
    [],
  );

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let cancelled = false;
    let created: EditorView | null = null;
    let controller: EditorSync | null = null;
    const report = (state: SaveState) => {
      onStateRef.current(state);
    };
    report({ kind: "loading" });

    fetchText(project, path).then(
      (loaded) => {
        if (cancelled) return;
        const editor = new EditorView({
          parent,
          state: EditorState.create({
            doc: loaded.text,
            extensions: [
              lineNumbers(),
              highlightActiveLineGutter(),
              highlightSpecialChars(),
              history(),
              drawSelection(),
              dropCursor(),
              indentOnInput(),
              editorHighlighting,
              bracketMatching(),
              closeBrackets(),
              autocompletion({ override: [latexCompletions] }),
              highlightActiveLine(),
              highlightSelectionMatches(),
              keymap.of([
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...completionKeymap,
                indentWithTab,
              ]),
              latexLanguage,
              EditorView.lineWrapping,
              EditorState.readOnly.of(!loaded.editable),
              EditorView.editable.of(loaded.editable),
              EditorView.contentAttributes.of({
                "aria-label": `Editor for ${path}`,
              }),
              editorTheme,
              EditorView.updateListener.of((update) => {
                if (
                  update.docChanged &&
                  !update.transactions.some((t) => t.annotation(fromDisk))
                ) {
                  controller?.edited();
                }
              }),
            ],
          }),
        });
        created = editor;
        controller = new EditorSync(project, path, loaded, {
          getText: () => editor.state.doc.toString(),
          applyFromDisk: (text) => {
            const anchor = Math.min(
              editor.state.selection.main.anchor,
              text.length,
            );
            editor.dispatch({
              changes: { from: 0, to: editor.state.doc.length, insert: text },
              selection: { anchor },
              annotations: [fromDisk.of(true)],
            });
          },
          onState: report,
          onConflict: setConflict,
        });
        view.current = editor;
        sync.current = controller;
        setFile(loaded);
        setLoadError(null);
        report(
          loaded.editable
            ? { kind: "saved" }
            : { kind: "readonly", reason: loaded.reason ?? "not_utf8" },
        );
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(err));
        report({ kind: "error", message: errorMessage(err) });
      },
    );

    return () => {
      cancelled = true;
      controller?.dispose();
      created?.destroy();
      if (view.current === created) view.current = null;
      if (sync.current === controller) sync.current = null;
    };
  }, [project, path, reloadKey]);

  useEffect(() => {
    if (diskChange?.paths.includes(path)) void sync.current?.diskChanged();
  }, [diskChange, path]);

  useEffect(() => {
    const v = view.current;
    if (!file || !v || !jump) return;
    const line = v.state.doc.line(
      Math.min(Math.max(jump.line, 1), v.state.doc.lines),
    );
    v.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    v.focus();
  }, [file, jump]);

  return (
    <div className="local-editor">
      {conflict && (
        <div className="editor-banner warning" role="alert">
          <span>
            This file was changed by another program while you were editing.
          </span>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void sync.current?.keepMine()}
          >
            Keep my version
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void sync.current?.loadFromDisk()}
          >
            Load from disk
          </button>
        </div>
      )}
      {file && !file.editable && (
        <div className="editor-banner" role="status">
          {file.reason === "too_large" ? (
            <span>This file is larger than 2 MB and is shown read-only.</span>
          ) : (
            <>
              <span>
                This file is not UTF-8 (shown as Windows-1252) and is read-only.
              </span>
              <button
                type="button"
                className="button ghost small"
                onClick={() => {
                  convertToUtf8(project, path).then(
                    () => {
                      setReloadKey((k) => k + 1);
                    },
                    (err: unknown) => {
                      onStateRef.current({
                        kind: "error",
                        message: errorMessage(err),
                      });
                    },
                  );
                }}
              >
                Convert to UTF-8
              </button>
            </>
          )}
        </div>
      )}
      {loadError && <p className="form-error editor-loading">{loadError}</p>}
      <div
        className="editor-host"
        ref={host}
        data-testid="editor"
        data-ready={file !== null}
      />
    </div>
  );
}
