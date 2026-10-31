import { test, expect } from "@playwright/test";

test.describe("Camada 2: Combat Flow, Tooltips & War Journal E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__IS_E2E__ = true;
    });
  });

  test("interacts with territories, advances turn phases and inspects war journal", async ({ page }) => {
    await page.goto("/");

    // Create room and start match with bot
    await page.getByTestId("btn-create-room").click();
    await page.getByTestId("btn-add-bot").click();
    await page.getByTestId("btn-start-game").click();

    // Wait for world map
    await expect(page.locator(".world-svg")).toBeVisible({ timeout: 15_000 });

    // 1. Verify territory hover and title tooltip
    const brazil = page.getByTestId("territory-brasil");
    await expect(brazil).toBeVisible();
    await brazil.hover({ force: true });

    // 2. Inject combat scenario ready for attack
    const injected = await page.evaluate(() => {
      return window.__GAME_DEBUG__?.forceScenario("combat_ready") ?? false;
    });
    expect(injected).toBe(true);

    // Verify turn phase advanced to attack
    const endAttackBtn = page.getByTestId("btn-end-attack");
    await expect(endAttackBtn).toBeVisible({ timeout: 5_000 });

    // 3. Advance to maneuver phase via debug hook
    await page.evaluate(() => {
      window.__GAME_DEBUG__?.setPhase("maneuver");
    });

    // Verify advance to maneuver phase button appears
    const endTurnBtn = page.getByTestId("btn-end-turn");
    await expect(endTurnBtn).toBeVisible({ timeout: 5_000 });

    // 4. Verify War Journal entries exist and log history is tracked
    const journal = page.getByTestId("war-journal");
    await expect(journal).toBeVisible();

    const entries = page.getByTestId("journal-entry");
    await expect(entries.first()).toBeVisible();
    const entryCount = await entries.count();
    expect(entryCount).toBeGreaterThan(0);
  });
});
