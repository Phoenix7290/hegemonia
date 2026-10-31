import { test, expect } from "@playwright/test";

test.describe("Camada 2: Full Game Flow & Debug Testability", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__IS_E2E__ = true;
    });
  });

  test("creates a custom room, adds a bot, launches match, and verifies HUD & tactical map", async ({ page }) => {
    await page.goto("/");

    // 1. Create a custom room
    const createBtn = page.getByTestId("btn-create-room");
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // 2. Wait for briefing war room (lobby)
    const addBotBtn = page.getByTestId("btn-add-bot");
    await expect(addBotBtn).toBeVisible({ timeout: 10_000 });

    // Add 1 bot opponent
    await addBotBtn.click();

    // 3. Start game
    const startBtn = page.getByTestId("btn-start-game");
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // 4. Verify transition into game session
    const map = page.locator(".world-svg");
    await expect(map).toBeVisible({ timeout: 15_000 });

    // Verify key UI components via semantic selectors
    await expect(page.getByTestId("territory-brasil")).toBeVisible();
    await expect(page.getByTestId("world-tension-badge")).toBeVisible();
    await expect(page.getByTestId("war-journal")).toBeVisible();
    await expect(page.getByTestId("res-money")).toBeVisible();

    // 5. Test window.__GAME_DEBUG__ availability and scenario injection
    const debugAvailable = await page.evaluate(() => Boolean(window.__GAME_DEBUG__));
    expect(debugAvailable).toBe(true);

    // Inject "rich_market" scenario
    const injected = await page.evaluate(() => {
      return window.__GAME_DEBUG__?.forceScenario("rich_market") ?? false;
    });
    expect(injected).toBe(true);

    // Verify money updated to $500 in HUD
    await expect(page.getByTestId("res-money")).toContainText("500");

    // 6. Test Market drawer toggle
    const marketBtn = page.getByTestId("btn-open-market");
    await marketBtn.click();
    await expect(page.getByTestId("market-modal")).toBeVisible();

    // Close market drawer
    await page.locator(".market-drawer .btn-close").click();
    await expect(page.getByTestId("market-modal")).not.toBeVisible();
  });
});
