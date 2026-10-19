import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { inWorkspace, openProject, uniqueName } from "./helpers.ts";

const editor = (page: Page) => page.locator(".cm-content");
const saveState = (page: Page) => page.getByTestId("save-state");

async function ready(page: Page) {
  await expect(page.getByTestId("editor")).toHaveAttribute(
    "data-ready",
    "true",
  );
}

async function typeAtEnd(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

test.describe("L2: editor", () => {
  test("edits are autosaved to disk and survive a reload", async ({ page }) => {
    const name = uniqueName("Edit");
    await openProject(page, name);
    await ready(page);

    await typeAtEnd(page, "\n% autosaved 42");
    await expect(saveState(page)).toHaveText("Unsaved changes");
    await expect(saveState(page)).toHaveText("Saved", { timeout: 5000 });
    expect(readFileSync(inWorkspace(name, "main.tex"), "utf8")).toContain(
      "% autosaved 42",
    );

    await page.reload();
    await ready(page);
    await expect(editor(page)).toContainText("% autosaved 42");
  });

  test("Ctrl/Cmd+S saves immediately", async ({ page }) => {
    const name = uniqueName("Shortcut");
    await openProject(page, name);
    await ready(page);
    await typeAtEnd(page, "\n% saved by shortcut");
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => readFileSync(inWorkspace(name, "main.tex"), "utf8"), {
        timeout: 900,
      })
      .toContain("% saved by shortcut");
  });

  test("changes from another program appear live", async ({ page }) => {
    const name = uniqueName("Live");
    await openProject(page, name);
    await ready(page);

    writeFileSync(inWorkspace(name, "main.tex"), "Written by another editor\n");
    await expect(editor(page)).toHaveText("Written by another editor");

    writeFileSync(inWorkspace(name, "refs.bib"), "@book{a}\n");
    await expect(
      page.getByRole("treeitem", { name: "refs.bib" }),
    ).toBeVisible();
  });

  test("a conflicting change asks the user, both ways", async ({ page }) => {
    const name = uniqueName("Conflict");
    await openProject(page, name);
    await ready(page);
    const main = inWorkspace(name, "main.tex");

    // Load from disk
    await typeAtEnd(page, "\n% mine 1");
    writeFileSync(main, "theirs 1\n");
    await expect(
      page.getByRole("alert").filter({ hasText: "changed by another program" }),
    ).toBeVisible();
    await expect(saveState(page)).toHaveText("Changed on disk");
    await page.getByRole("button", { name: "Load from disk" }).click();
    await expect(editor(page)).toHaveText("theirs 1");
    await expect(saveState(page)).toHaveText("Saved");

    // Keep my version
    await typeAtEnd(page, "% mine 2");
    writeFileSync(main, "theirs 2\n");
    await expect(
      page.getByRole("button", { name: "Keep my version" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep my version" }).click();
    await expect(saveState(page)).toHaveText("Saved");
    expect(readFileSync(main, "utf8")).toBe("theirs 1\n% mine 2");
  });

  test("Windows line endings are kept", async ({ page }) => {
    const name = uniqueName("CRLF");
    await openProject(page, name);
    writeFileSync(inWorkspace(name, "win.tex"), "one\r\ntwo\r\n");
    await page.getByRole("treeitem", { name: "win.tex" }).click();
    await ready(page);

    await typeAtEnd(page, "three");
    await expect(saveState(page)).toHaveText("Saved", { timeout: 5000 });
    expect(readFileSync(inWorkspace(name, "win.tex"), "utf8")).toBe(
      "one\r\ntwo\r\nthree",
    );
  });

  test("Latin-1 files are read-only until converted", async ({ page }) => {
    const name = uniqueName("Latin1");
    await openProject(page, name);
    writeFileSync(
      inWorkspace(name, "old.tex"),
      Buffer.from("Gr\xfc\xdfe\n", "latin1"),
    );
    await page.getByRole("treeitem", { name: "old.tex" }).click();
    await ready(page);

    await expect(editor(page)).toHaveText("Grüße");
    await expect(saveState(page)).toHaveText("Read-only");
    await expect(editor(page)).toHaveAttribute("contenteditable", "false");

    await page.getByRole("button", { name: "Convert to UTF-8" }).click();
    await expect(saveState(page)).toHaveText("Saved");
    await expect(editor(page)).toHaveAttribute("contenteditable", "true");
    expect(readFileSync(inWorkspace(name, "old.tex"), "utf8")).toBe("Grüße\n");
  });
});
