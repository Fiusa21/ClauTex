import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { inWorkspace, openProject, uniqueName } from "./helpers.ts";

// Uses the fake latexmk (see apps/server/test/fake-latexmk.mjs) unless TEXCOLLAB_E2E_REAL_TEX=1.
test.skip(
  process.env.TEXCOLLAB_E2E_REAL_TEX === "1",
  "covered by compile-real.spec.ts",
);

const status = (page: Page) => page.getByTestId("compile-status");

async function ready(page: Page) {
  await expect(page.getByTestId("editor")).toHaveAttribute(
    "data-ready",
    "true",
  );
}

test.describe("L3: compile (fake TeX)", () => {
  test("Compile shows the PDF and Ctrl/Cmd+S saves before compiling", async ({
    page,
  }) => {
    const name = uniqueName("Compile");
    await openProject(page, name);
    await ready(page);
    await expect(status(page)).toContainText("Not compiled yet");

    await page.getByRole("button", { name: "Compile" }).click();
    await expect(status(page)).toContainText("Compiled in");
    await expect(page.getByTestId("pdf-page")).toHaveText("1 / 1");
    await expect(page.getByLabel("Page 1")).toBeVisible();

    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n% saved before compile");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(status(page)).toContainText("Compiled in");
    expect(readFileSync(inWorkspace(name, "main.tex"), "utf8")).toContain(
      "% saved before compile",
    );

    // The last build is shown again after a reload.
    await page.reload();
    await expect(page.getByTestId("pdf-page")).toHaveText("1 / 1");
  });

  test("errors jump to the line; the last good PDF stays visible", async ({
    page,
  }) => {
    const name = uniqueName("Errors");
    await openProject(page, name);
    await ready(page);
    await page.getByRole("button", { name: "Compile" }).click();
    await expect(status(page)).toContainText("Compiled in");

    writeFileSync(
      inWorkspace(name, "main.tex"),
      "first line\nsecond line\nBREAK third line\nfourth line\n",
    );
    await expect(page.locator(".cm-content")).toContainText("BREAK third line");
    await page.getByRole("button", { name: "Compile" }).click();

    await expect(status(page)).toContainText("Compile failed");
    await expect(page.getByTestId("stale-pdf")).toBeVisible();
    await expect(page.getByTestId("pdf-page")).toHaveText("1 / 1");
    const issue = page.getByRole("button", { name: /main\.tex:3/ });
    await expect(issue).toContainText("Undefined control sequence");
    await issue.click();
    await expect(page.locator(".cm-activeLine")).toHaveText("BREAK third line");
  });

  test("the compiler choice is stored in the project folder", async ({
    page,
  }) => {
    const name = uniqueName("Engine");
    await openProject(page, name);
    await page.getByLabel("Compiler").selectOption("xelatex");
    await expect
      .poll(() => {
        try {
          return (
            JSON.parse(
              readFileSync(inWorkspace(name, ".texcollab.json"), "utf8"),
            ) as { compiler: string }
          ).compiler;
        } catch {
          return null;
        }
      })
      .toBe("xelatex");
  });
});
