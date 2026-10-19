import { expect, test } from "@playwright/test";

test("the app loads and shows the workspace folder", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");

  await expect(page).toHaveTitle("TexCollab");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByTestId("workspace")).toContainText(
    process.env.TEXCOLLAB_E2E_WORKSPACE ?? "",
  );
  expect(errors).toEqual([]);
});

test("client-side routes are served by the SPA fallback", async ({ page }) => {
  await page.goto("/does/not/exist");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
});

test("/api/health reports the server", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "UP" });
  expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
});

test("requests from another website are rejected", async ({ request }) => {
  const res = await request.get("/api/health", {
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
  });
  expect(res.status()).toBe(403);
});
