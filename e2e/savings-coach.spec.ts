import { expect, test } from "@playwright/test";
import { getStoreRecords, openDemo } from "./helpers";

test.describe("Savings Coach", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== "chromium", "Savings Coach browser flow runs once on desktop Chromium.");
  });

  test("checks a purchase and creates a savings goal from the Coach page", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/coach");

    await expect(page.getByRole("heading", { name: "Coach" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current watchlist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Purchase check" })).toBeVisible();

    const purchaseSection = page.locator("#purchase");
    await purchaseSection.getByLabel("Item").fill("Scenario coffee");
    await purchaseSection.getByLabel("Amount").fill("10.00");
    await purchaseSection.getByRole("button", { name: "Check" }).click();

    await expect(page.getByText("Purchase check saved.")).toBeVisible();
    await expect(page.getByText(/Looks safe|Use caution|Not recommended/)).toBeVisible();

    const checks = await getStoreRecords<{ label: string; amountMinor: number }>(page, "bluehour-profile-demo", "purchaseChecks");
    expect(checks).toContainEqual(expect.objectContaining({ label: "Scenario coffee", amountMinor: 1_000 }));

    const goalsSection = page.locator("#goals");
    await goalsSection.getByLabel("Goal").fill("Scenario rainy day");
    await goalsSection.getByLabel("Target").fill("100.00");
    await goalsSection.getByRole("button", { name: /Save goal/i }).click();

    await expect(page.getByText("Savings goal saved.")).toBeVisible();
    await expect(goalsSection.getByText("Scenario rainy day")).toBeVisible();

    const goals = await getStoreRecords<{ name: string; targetMinor: number }>(page, "bluehour-profile-demo", "savingsGoals");
    expect(goals).toContainEqual(expect.objectContaining({ name: "Scenario rainy day", targetMinor: 10_000 }));
  });
});
