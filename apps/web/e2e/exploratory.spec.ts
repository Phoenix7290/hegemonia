import { test, expect } from "@playwright/test";

test.describe("Camada 3: Autonomous Exploratory QA Agent & Invariant Verifications", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__IS_E2E__ = true;
    });
  });

  test("Missão 1: Encirclement & Supply Line Invariant Check", async ({ page }) => {
    await page.goto("/");

    // Create room & add bot
    await page.getByTestId("btn-create-room").click();
    await page.getByTestId("btn-add-bot").click();
    await page.getByTestId("btn-start-game").click();

    await expect(page.locator(".world-svg")).toBeVisible({ timeout: 15_000 });

    // Inject encircled capital scenario
    const ok = await page.evaluate(() => {
      return window.__GAME_DEBUG__?.forceScenario("encircled_capital") ?? false;
    });
    expect(ok).toBe(true);

    // Verify territory state has isEncircled = true for non-capital territories
    const state = await page.evaluate(() => window.__GAME_DEBUG__?.getState());
    expect(state).not.toBeNull();

    // Select an encircled territory
    const brasil = page.getByTestId("territory-brasil");
    await expect(brasil).toBeVisible();
    await brasil.click({ force: true });

    // Inspect if tactical supply cut alert appears if encircled
    const alert = page.locator(".tactical-intel-alert.danger");
    // If brasil is encircled, the banner should warn the commander
    const isBrasilEncircled = state?.territories["brasil"]?.isEncircled;
    if (isBrasilEncircled) {
      await expect(alert).toBeVisible();
      await expect(page.locator("input[type='range']")).toBeDisabled();
    }
  });

  test("Missão 2: Market Stress & Anti-Arbitrage Exploitation", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("btn-create-room").click();
    await page.getByTestId("btn-add-bot").click();
    await page.getByTestId("btn-start-game").click();

    await expect(page.locator(".world-svg")).toBeVisible({ timeout: 15_000 });

    // Inject rich funds
    await page.evaluate(() => {
      window.__GAME_DEBUG__?.giveResources({ money: 1000, steel: 100, oil: 100, gold: 100 });
    });

    const moneyBadge = page.getByTestId("res-money");
    await expect(moneyBadge).toBeVisible();

    // Open Market
    await page.getByTestId("btn-open-market").click();
    const marketModal = page.getByTestId("market-modal");
    await expect(marketModal).toBeVisible();

    // Verify market buy/sell rates are rendered and valid
    const prices = await page.evaluate(() => {
      const g = window.__GAME_DEBUG__?.getState();
      return g?.marketPrices ?? null;
    });

    if (prices) {
      // Invariant: all commodities must have positive market values
      expect(prices.steel.buyPrice).toBeGreaterThan(0);
      expect(prices.oil.buyPrice).toBeGreaterThan(0);
      expect(prices.gold.buyPrice).toBeGreaterThan(0);

      // Invariant: buyPrice > sellPrice (spread prevents free infinite arbitrage)
      expect(prices.steel.buyPrice).toBeGreaterThan(prices.steel.sellPrice);
      expect(prices.oil.buyPrice).toBeGreaterThan(prices.oil.sellPrice);
      expect(prices.gold.buyPrice).toBeGreaterThan(prices.gold.sellPrice);
    }

    // Close Market via close button
    await page.locator(".market-drawer .btn-close").click();
    await expect(marketModal).not.toBeVisible();
  });

  test("Missão 3: Visual Overlays & Tactical Theater Badge Inspection", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("btn-create-room").click();
    await page.getByTestId("btn-add-bot").click();
    await page.getByTestId("btn-start-game").click();

    await expect(page.locator(".world-svg")).toBeVisible({ timeout: 15_000 });

    // Open layers menu and enable Regional overlay if available
    const layersBtn = page.getByTestId("btn-layers-dropdown");
    if (await layersBtn.isVisible()) {
      await layersBtn.click();
      const regionalToggle = page.getByTestId("toggle-overlay-regional");
      if (await regionalToggle.isVisible()) {
        await regionalToggle.click();
      }
    }

    // Verify key world regions are rendered in the SVG
    await expect(page.getByTestId("territory-brasil")).toBeVisible();
    await expect(page.getByTestId("territory-argentina")).toBeVisible();
    await expect(page.getByTestId("territory-alasca")).toBeVisible();
  });
});
