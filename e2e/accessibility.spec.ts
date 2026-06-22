import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openDemo } from "./helpers";

test.describe("accessibility automation", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== "chromium", "Accessibility audit runs once on desktop Chromium.");
  });

  test("major demo pages pass automated axe checks", async ({ page }) => {
    test.setTimeout(60_000);
    await openDemo(page);

    for (const path of ["/", "/#/transactions", "/#/plan", "/#/budgets", "/#/subscriptions", "/#/net-worth", "/#/review", "/#/settings"]) {
      await page.goto(path);
      await expect(page.locator("main h1, h1").first()).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `${path} accessibility violations`).toEqual([]);
    }
  });

  test("command dialog has keyboard focus and passes automated axe checks", async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press("Meta+K");

    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();
    await expect(page.getByRole("button", { name: /New transaction/i })).toBeFocused();

    const results = await new AxeBuilder({ page }).include(".command-menu").analyze();
    expect(results.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command menu" })).toHaveCount(0);
  });
});
