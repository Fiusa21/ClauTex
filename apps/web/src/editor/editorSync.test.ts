import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveResult, TextFile } from "../api/text.ts";
import { AUTOSAVE_DELAY_MS, EditorSync } from "./editorSync.ts";
import type { SaveState } from "./saveState.ts";

const file = (text: string, etag: string): TextFile => ({
  path: "main.tex",
  text,
  etag,
  editable: true,
  encoding: "utf-8",
  lineEnding: "lf",
  reason: null,
});

/** A fake editor plus a fake server that the tests control. */
function setup(initial = file("hello", "e0")) {
  let text = initial.text;
  const states: SaveState["kind"][] = [];
  const conflicts: boolean[] = [];
  let disk = initial;
  const saveText = vi.fn(
    (
      _p: string,
      _f: string,
      body: string,
      baseEtag: string,
    ): Promise<SaveResult> =>
      baseEtag === disk.etag
        ? Promise.resolve(
            ((disk = file(body, `e${String(Number(disk.etag.slice(1)) + 1)}`)),
            { ok: true, etag: disk.etag }),
          )
        : Promise.resolve({ ok: false, conflictEtag: disk.etag }),
  );
  const fetchText = vi.fn(() => Promise.resolve(disk));
  const applied: string[] = [];
  const sync = new EditorSync(
    "P",
    "main.tex",
    initial,
    {
      getText: () => text,
      applyFromDisk: (t) => {
        applied.push(t);
        text = t;
      },
      onState: (s) => states.push(s.kind),
      onConflict: (c) => conflicts.push(c),
    },
    { saveText, fetchText },
  );
  return {
    sync,
    saveText,
    fetchText,
    states,
    conflicts,
    applied,
    type: (t: string) => {
      text = t;
      sync.edited();
    },
    writeOnDisk: (t: string, etag: string) => {
      disk = file(t, etag);
    },
    disk: () => disk,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("autosave", () => {
  it("saves once, about a second after the last keystroke", async () => {
    const t = setup();
    t.type("h");
    await vi.advanceTimersByTimeAsync(500);
    t.type("he");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(t.saveText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(t.saveText).toHaveBeenCalledTimes(1);
    expect(t.saveText).toHaveBeenCalledWith(
      "P",
      "main.tex",
      "he",
      "e0",
      undefined,
    );
    expect(t.disk().text).toBe("he");
    expect(t.states.at(-1)).toBe("saved");
  });

  it("saves edits made during a running save afterwards, against the new version", async () => {
    const t = setup();
    let release!: () => void;
    t.saveText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            t.writeOnDisk("first", "e1");
            resolve({ ok: true, etag: "e1" });
          };
        }),
    );
    t.type("first");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    t.type("second");
    release();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(t.saveText).toHaveBeenLastCalledWith(
      "P",
      "main.tex",
      "second",
      "e1",
      undefined,
    );
    expect(t.disk().text).toBe("second");
  });

  it("does nothing when the text equals what is on disk", async () => {
    const t = setup();
    t.type("hello");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(t.saveText).not.toHaveBeenCalled();
  });

  it("reports errors and retries with the next edit", async () => {
    const t = setup();
    t.saveText.mockRejectedValueOnce(new TypeError("offline"));
    t.type("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(t.states.at(-1)).toBe("error");

    t.type("ab");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(t.disk().text).toBe("ab");
  });
});

describe("changes made by other programs", () => {
  it("are loaded silently when there are no unsaved edits", async () => {
    const t = setup();
    t.writeOnDisk("from outside", "x1");
    await t.sync.diskChanged();
    expect(t.applied).toEqual(["from outside"]);
    expect(t.states.at(-1)).toBe("saved");
  });

  it("are ignored when they are our own save", async () => {
    const t = setup();
    t.type("mine");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await t.sync.diskChanged();
    expect(t.applied).toEqual([]);
  });

  it("raise a conflict while there are unsaved edits; autosave pauses until resolved", async () => {
    const t = setup();
    t.type("my edit");
    t.writeOnDisk("their edit", "x1");
    await t.sync.diskChanged();

    expect(t.states.at(-1)).toBe("conflict");
    expect(t.conflicts.at(-1)).toBe(true);
    t.type("my edit 2");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(t.saveText).not.toHaveBeenCalled();
    expect(t.disk().text).toBe("their edit");
  });

  it("'Keep my version' overwrites the file on disk", async () => {
    const t = setup();
    t.type("mine");
    t.writeOnDisk("theirs", "x1");
    await t.sync.diskChanged();

    await t.sync.keepMine();

    expect(t.disk().text).toBe("mine");
    expect(t.conflicts.at(-1)).toBe(false);
    expect(t.states.at(-1)).toBe("saved");
  });

  it("'Load from disk' replaces the editor text", async () => {
    const t = setup();
    t.type("mine");
    t.writeOnDisk("theirs", "x1");
    await t.sync.diskChanged();

    await t.sync.loadFromDisk();

    expect(t.applied).toEqual(["theirs"]);
    expect(t.conflicts.at(-1)).toBe(false);
  });

  it("a save that finds a newer version on disk becomes a conflict instead of overwriting", async () => {
    const t = setup();
    t.writeOnDisk("theirs", "x1"); // changed, but the watcher has not told us yet
    t.type("mine");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(t.states.at(-1)).toBe("conflict");
    expect(t.disk().text).toBe("theirs");
  });

  it("report a deleted file", async () => {
    const t = setup();
    t.fetchText.mockRejectedValueOnce(new Error("404"));
    await t.sync.diskChanged();
    expect(t.states.at(-1)).toBe("deleted");
  });
});

describe("closing the editor", () => {
  it("writes pending edits right away", async () => {
    const t = setup();
    t.type("unsaved");
    t.sync.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.saveText).toHaveBeenCalledWith(
      "P",
      "main.tex",
      "unsaved",
      "e0",
      true,
    );
    expect(t.disk().text).toBe("unsaved");
  });

  it("does not overwrite during an unresolved conflict", async () => {
    const t = setup();
    t.type("mine");
    t.writeOnDisk("theirs", "x1");
    await t.sync.diskChanged();
    t.sync.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(t.disk().text).toBe("theirs");
  });
});
