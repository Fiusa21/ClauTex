import { expect, test } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  createProject,
  inWorkspace,
  openProject,
  uniqueName,
} from "./helpers.ts";

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("L1: projects on disk", () => {
  test("create, rename, duplicate, delete and restore change the folders", async ({
    page,
  }) => {
    const name = uniqueName("Thesis");
    await createProject(page, name);
    expect(readFileSync(inWorkspace(name, "main.tex"), "utf8")).toContain(
      "\\documentclass{article}",
    );

    // Rename
    const row = page.getByTestId("project-row").filter({ hasText: name });
    await row.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel(`New name for ${name}`).fill(`${name} final`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("link", { name: `${name} final`, exact: true }),
    ).toBeVisible();
    expect(existsSync(inWorkspace(name))).toBe(false);
    expect(existsSync(inWorkspace(`${name} final`, "main.tex"))).toBe(true);

    // Duplicate
    await page
      .getByTestId("project-row")
      .filter({ hasText: `${name} final` })
      .first()
      .getByRole("button", { name: "Duplicate" })
      .click();
    await expect(
      page.getByRole("link", { name: `Copy of ${name} final`, exact: true }),
    ).toBeVisible();
    expect(existsSync(inWorkspace(`Copy of ${name} final`, "main.tex"))).toBe(
      true,
    );

    // Delete → trash folder
    page.once("dialog", (d) => void d.accept());
    await page
      .getByTestId("project-row")
      .filter({ hasText: `Copy of ${name} final` })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(
      page.getByRole("link", { name: `Copy of ${name} final`, exact: true }),
    ).toHaveCount(0);
    expect(existsSync(inWorkspace(`Copy of ${name} final`))).toBe(false);
    expect(
      readdirSync(inWorkspace(".trash")).some((e) =>
        e.startsWith(`Copy of ${name} final~`),
      ),
    ).toBe(true);

    // Restore
    await page.getByRole("button", { name: "Trash" }).click();
    await page
      .getByTestId("trash-row")
      .filter({ hasText: `Copy of ${name} final` })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.getByRole("button", { name: "Projects" }).click();
    await expect(
      page.getByRole("link", { name: `Copy of ${name} final`, exact: true }),
    ).toBeVisible();
    expect(existsSync(inWorkspace(`Copy of ${name} final`, "main.tex"))).toBe(
      true,
    );
  });

  test("invalid project names are explained", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("New project name").fill("what?");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("alert")).toContainText(
      'Names must not contain any of < > : " | ? *',
    );
  });
});

test.describe("L1: files on disk", () => {
  test("create, rename, move, upload and delete files", async ({ page }) => {
    const name = uniqueName("Files");
    await openProject(page, name);
    const tree = page.getByRole("navigation", { name: "Project files" });
    await expect(page.locator(".cm-content")).toContainText(
      "\\documentclass{article}",
    );

    // New folder and a file inside it
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("New folder name").fill("chapters");
    await page.keyboard.press("Enter");
    await tree.getByRole("treeitem", { name: "chapters" }).click();
    await page.getByRole("button", { name: "New file" }).click();
    await page.getByLabel("New file name").fill("intro.tex");
    await page.keyboard.press("Enter");
    await expect(page.locator(".editor-path")).toHaveText("chapters/intro.tex");
    expect(existsSync(inWorkspace(name, "chapters", "intro.tex"))).toBe(true);

    // Rename keeps the file selected
    await tree.getByRole("button", { name: "Rename intro.tex" }).click();
    await page.getByLabel("New name for intro.tex").fill("1-intro.tex");
    await page.keyboard.press("Enter");
    await expect(page.locator(".editor-path")).toHaveText(
      "chapters/1-intro.tex",
    );
    expect(existsSync(inWorkspace(name, "chapters", "1-intro.tex"))).toBe(true);
    expect(existsSync(inWorkspace(name, "chapters", "intro.tex"))).toBe(false);

    // Move by dragging onto the root of the tree
    await tree
      .getByRole("treeitem", { name: "1-intro.tex" })
      .dragTo(page.getByRole("tree", { name: "Files" }), {
        targetPosition: { x: 20, y: 300 },
      });
    await expect(
      tree.getByRole("treeitem", { name: /^1-intro\.tex/ }),
    ).toBeVisible();
    await expect
      .poll(() => existsSync(inWorkspace(name, "1-intro.tex")))
      .toBe(true);

    // Upload an image into the root and preview it
    await tree.getByRole("treeitem", { name: "main.tex" }).click();
    await page
      .getByTestId("upload-input")
      .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG });
    await tree.getByRole("treeitem", { name: "dot.png" }).click();
    await expect
      .poll(() =>
        page
          .locator(".binary-view img")
          .evaluate((el: HTMLImageElement) => el.naturalWidth),
      )
      .toBe(1);
    expect(readFileSync(inWorkspace(name, "dot.png"))).toEqual(PNG);

    // Delete moves the folder to the workspace trash
    page.once("dialog", (d) => void d.accept());
    await tree.getByRole("button", { name: "Delete chapters" }).click();
    await expect(tree.getByRole("treeitem", { name: "chapters" })).toHaveCount(
      0,
    );
    expect(existsSync(inWorkspace(name, "chapters"))).toBe(false);
    expect(existsSync(inWorkspace(".trash", name))).toBe(true);

    // The main file cannot be deleted
    page.once("dialog", (d) => void d.accept());
    await tree.getByRole("button", { name: "Delete main.tex" }).click();
    await expect(tree.getByRole("alert")).toContainText("main file");
    expect(existsSync(inWorkspace(name, "main.tex"))).toBe(true);
  });

  test("changes made outside the app show up after reload", async ({
    page,
  }) => {
    const name = uniqueName("External");
    await openProject(page, name);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      inWorkspace(name, "notes.md"),
      "# Written by another program",
    );
    await page.reload();
    await page.getByRole("treeitem", { name: "notes.md" }).click();
    await expect(page.locator(".cm-content")).toHaveText(
      "# Written by another program",
    );
  });
});
