import { test, expect } from "@playwright/test";

test.describe("Camada 2: Smoke E2E & Command Center", () => {
  test.beforeEach(async ({ page }) => {
    // Injects E2E test flag to expose debug hooks
    await page.addInitScript(() => {
      window.__IS_E2E__ = true;
    });
  });

  test("loads the application and renders the command deck", async ({ page }) => {
    await page.goto("/");

    // Verify main interactive elements exist
    await expect(page.locator("header.deck-hero")).toBeVisible();
    await expect(page.getByTestId("btn-create-room")).toBeVisible();
    await expect(page.getByTestId("room-code-input")).toBeVisible();
    await expect(page.getByTestId("btn-join-room")).toBeVisible();
  });

  test("validates room code input formatting", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("room-code-input");
    const joinBtn = page.getByTestId("btn-join-room");

    // Initially disabled when empty
    await expect(joinBtn).toBeDisabled();

    // Type 6-char room code
    await input.fill("a1b2c3");
    await expect(joinBtn).toBeEnabled();
  });
});
