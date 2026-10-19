import { expect, type Page } from "@playwright/test";
import { join } from "node:path";

/** The temporary workspace the e2e server runs against (see playwright.config.ts). */
export const workspace = process.env.TEXCOLLAB_E2E_WORKSPACE ?? "";

export const inWorkspace = (...parts: string[]) => join(workspace, ...parts);

/** A project name unique to this test run. */
export const uniqueName = (prefix: string) =>
  `${prefix} ${Math.random().toString(36).slice(2, 7)}`;

export async function createProject(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder("New project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
}

export async function openProject(page: Page, name: string): Promise<void> {
  await createProject(page, name);
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}
