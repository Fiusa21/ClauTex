import { expect, test } from "@playwright/test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inWorkspace, openProject, uniqueName } from "./helpers.ts";

const fakeTex = process.env.TEXCOLLAB_E2E_REAL_TEX !== "1";

/** Relative path → base64 content for every file below a folder. */
function snapshot(dir: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, snapshot(dir, path));
    else out[path] = readFileSync(join(dir, path)).toString("base64");
  }
  return out;
}

test.describe("L4: polish", () => {
  test("a ZIP exported from one project imports as an identical project", async ({
    page,
  }) => {
    const name = uniqueName("Zip");
    await openProject(page, name);
    mkdirSync(inWorkspace(name, "chapters", "deep"), { recursive: true });
    writeFileSync(inWorkspace(name, "chapters", "deep", "a.tex"), "Grüße\r\n");
    writeFileSync(inWorkspace(name, "figure.png"), randomBytes(50_000));
    await page.getByLabel("Compiler").selectOption("lualatex");
    await expect
      .poll(() => readFileSync(inWorkspace(name, ".texcollab.json"), "utf8"))
      .toContain("lualatex");

    await page.goto("/");
    const download = page.waitForEvent("download");
    await page
      .getByTestId("project-row")
      .filter({ hasText: name })
      .getByRole("link", { name: "Export" })
      .click();
    const zipPath = join(
      mkdtempSync(join(tmpdir(), "texcollab-dl-")),
      `${name} export.zip`,
    );
    await (await download).saveAs(zipPath);

    await page.getByTestId("import-input").setInputFiles(zipPath);
    await expect(
      page.getByRole("heading", { name: `${name} export` }),
    ).toBeVisible();
    await expect(page.getByLabel("Compiler")).toHaveValue("lualatex");
    expect(snapshot(inWorkspace(`${name} export`))).toEqual(
      snapshot(inWorkspace(name)),
    );
  });

  test("a folder outside the workspace can be opened, edited and removed from the list", async ({
    page,
  }) => {
    const folder = join(
      mkdtempSync(join(tmpdir(), "texcollab-outside-")),
      "Existing thesis",
    );
    mkdirSync(join(folder, "chapters"), { recursive: true });
    writeFileSync(join(folder, "thesis.tex"), "\\documentclass{article}\n");
    writeFileSync(join(folder, "chapters", "one.tex"), "Chapter one\n");

    await page.goto("/");
    await page.getByRole("button", { name: "Open folder…" }).click();
    await page.getByLabel("Folder path").fill(folder);
    await page.getByRole("button", { name: "Open", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Existing thesis" }),
    ).toBeVisible();
    await expect(page.locator(".editor-path")).toHaveText("thesis.tex");
    await expect(page.getByTestId("editor")).toHaveAttribute(
      "data-ready",
      "true",
    );
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("% edited in TexCollab");
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => readFileSync(join(folder, "thesis.tex"), "utf8"))
      .toContain("% edited in TexCollab");

    await page.goto("/");
    const opened = page
      .getByRole("list", { name: "Opened folders" })
      .getByTestId("project-row");
    await expect(opened).toContainText("Existing thesis");
    await expect(opened.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await opened.getByRole("button", { name: "Remove from list" }).click();
    await expect(
      page.getByRole("list", { name: "Opened folders" }),
    ).toHaveCount(0);
    expect(readdirSync(folder).sort()).toEqual(["chapters", "thesis.tex"]);
  });

  test("settings persist; a workspace set on the command line is shown as fixed", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(
      page.getByText("Set when TexCollab was started"),
    ).toBeVisible();

    await page.getByLabel("Timeout (seconds)").fill("300");
    await page.getByRole("button", { name: "Save" }).click();
    await page.reload();
    await expect(page.getByLabel("Timeout (seconds)")).toHaveValue("300");
    await page.getByLabel("Timeout (seconds)").fill("120");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Timeout (seconds)")).toHaveValue("120");
  });

  test("Docker mode: download the image, then compile in a container", async ({
    page,
  }) => {
    test.skip(!fakeTex, "uses the fake docker CLI");
    await page.goto("/settings");
    await page.getByLabel("Docker (TeX Live image, sandboxed)").check();
    try {
      await page.getByRole("button", { name: /Download TeX image/ }).click();
      await expect(page.getByTestId("docker-status")).toContainText(
        "TeX image ready",
      );

      const name = uniqueName("Docker");
      await openProject(page, name);
      await page.getByRole("button", { name: "Compile" }).click();
      await expect(page.getByTestId("compile-status")).toContainText(
        "Compiled in",
      );
      await expect(page.getByTestId("pdf-page")).toHaveText("1 / 1");
    } finally {
      await page.goto("/settings");
      await page.getByLabel("TeX installed on this computer").check();
      await expect(
        page.getByLabel("TeX installed on this computer"),
      ).toBeChecked();
    }
  });
});
