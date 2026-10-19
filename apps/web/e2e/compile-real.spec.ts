import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { inWorkspace, openProject, uniqueName } from "./helpers.ts";

// Real TeX (SPEC §8, L3 acceptance). Run with TEXCOLLAB_E2E_REAL_TEX=1 on a machine with TeX installed.
test.skip(
  process.env.TEXCOLLAB_E2E_REAL_TEX !== "1",
  "needs a TeX installation (TEXCOLLAB_E2E_REAL_TEX=1)",
);

const status = (page: Page) => page.getByTestId("compile-status");

async function compileIn(
  page: Page,
  name: string,
  main: string,
  source: string,
) {
  writeFileSync(inWorkspace(name, main), source);
  if (main !== "main.tex") {
    const res = await page.request.patch(
      `/api/projects/${encodeURIComponent(name)}`,
      { data: { mainFile: main } },
    );
    expect(res.status()).toBe(200);
  }
  const res = await page.request.post(
    `/api/projects/${encodeURIComponent(name)}/compile`,
    { timeout: 120_000 },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    status: string;
    errors: { file: string; line: number; message: string }[];
    logExcerpt: string;
  };
}

test.describe("L3: compile (real TeX)", () => {
  test("the starter project compiles to a PDF", async ({ page }) => {
    const name = uniqueName("Real");
    await openProject(page, name);
    await page.getByRole("button", { name: "Compile" }).click();
    await expect(status(page)).toContainText("Compiled in", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("pdf-page")).toHaveText("1 / 1");
  });

  test("an error in an included file shows its path and line", async ({
    page,
  }) => {
    const name = uniqueName("RealErr");
    await openProject(page, name);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(inWorkspace(name, "chapters"));
    writeFileSync(
      inWorkspace(name, "chapters", "intro.tex"),
      "Some text.\n\\undefinedmacro\nMore.\n",
    );
    const build = await compileIn(
      page,
      name,
      "thesis.tex",
      "\\documentclass{article}\n\\begin{document}\n\\input{chapters/intro}\n\\end{document}\n",
    );
    expect(build.status).toBe("failure");
    expect(build.errors).toContainEqual({
      level: "error",
      file: "chapters/intro.tex",
      line: 2,
      message: "Undefined control sequence.",
    });
  });

  test("\\write18 does nothing", async ({ page }) => {
    const name = uniqueName("RealShell");
    await openProject(page, name);
    const build = await compileIn(
      page,
      name,
      "shell.tex",
      "\\documentclass{article}\n\\begin{document}\n\\immediate\\write18{echo hi > pwned.tex}\n\\input{pwned}\n\\end{document}\n",
    );
    expect(build.status).toBe("failure");
    expect(build.errors.map((e) => e.message).join("\n")).toContain(
      "pwned.tex' not found",
    );
    const log = await (
      await page.request.get(
        `/api/projects/${encodeURIComponent(name)}/output.log`,
      )
    ).text();
    expect(log).toContain("runsystem(echo hi > pwned.tex)...disabled");
  });

  test("an infinite loop is killed at the timeout", async ({ page }) => {
    test.setTimeout(90_000);
    const name = uniqueName("RealLoop");
    await openProject(page, name);
    await page.request.patch("/api/settings", {
      data: { compileTimeoutSeconds: 15 },
    });
    try {
      const started = Date.now();
      const build = await compileIn(
        page,
        name,
        "loop.tex",
        "\\documentclass{article}\n\\begin{document}\n\\def\\x{\\x}\\x\n\\end{document}\n",
      );
      const seconds = (Date.now() - started) / 1000;
      expect(build.status).toBe("timeout");
      expect(seconds).toBeGreaterThanOrEqual(14);
      expect(seconds).toBeLessThan(40);
    } finally {
      await page.request.patch("/api/settings", {
        data: { compileTimeoutSeconds: 120 },
      });
    }
  });
});
