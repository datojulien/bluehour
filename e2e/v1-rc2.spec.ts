import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getStoreRecords, openDemo } from "./helpers";

test.describe("V1 RC2 completed flows", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== "chromium", "V1 RC2 flow suite runs once on desktop Chromium.");
  });

  test("dashboard shows exact budget progress, cycle fallback, and real activity", async ({ page }) => {
    await openDemo(page);

    await expect(page.getByText(/Allocated RM/).first()).toBeVisible();
    await expect(page.getByText(/Reserved RM/).first()).toBeVisible();
    await expect(page.getByText(/Remaining RM/).first()).toBeVisible();
    await expect(page.getByText("Recent Activity")).toBeVisible();
    await expect(page.getByText("Cycle comparison will be available after another completed cycle.")).toBeVisible();
    await expect(page.getByText("55%")).toHaveCount(0);
  });

  test("category manager creates, renames, archives, restores, reorders, and passes axe", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/settings#categories");
    const manager = page.locator("#categories");

    await manager.locator("form.dashboard-subsection").getByRole("textbox", { name: "Name", exact: true }).fill("Scenario Fun");
    await manager.getByRole("button", { name: /Create category/i }).click();
    await expect(page.getByText("Category changes saved.")).toBeVisible();
    await expect(manager.getByRole("textbox", { name: "Scenario Fun name" })).toBeVisible();

    await manager.getByRole("textbox", { name: "Scenario Fun name" }).fill("Scenario Joy");
    await manager.getByRole("button", { name: /Save Scenario Fun/i }).click();
    await expect(manager.getByRole("textbox", { name: "Scenario Joy name" })).toBeVisible();

    const row = manager.getByRole("textbox", { name: "Scenario Joy name" }).locator("xpath=ancestor::form[1]");
    await row.getByLabel("Confirm").check();
    await row.getByRole("button", { name: "Archive" }).click();
    await expect(row.getByText("archived")).toBeVisible();
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(row.getByText("active")).toBeVisible();
    await row.getByRole("button", { name: "Move up" }).click();

    const categories = await getStoreRecords<{ name: string }>(page, "bluehour-profile-demo", "categories");
    expect(categories.some((category) => category.name === "Scenario Joy")).toBe(true);

    const results = await new AxeBuilder({ page }).include("#categories").analyze();
    expect(results.violations).toEqual([]);
  });

  test("subscriptions show monthly equivalents, allow metadata edits, and archive safely", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/subscriptions");

    await expect(page.getByText(/Monthly .*RM39\.00/i)).toBeVisible();
    const editorResults = await new AxeBuilder({ page }).include("main").analyze();
    expect(editorResults.violations).toEqual([]);

    const row = page.locator(".data-row", { hasText: "Orchid Cloud" });
    await row.getByLabel("Orchid Cloud notes").fill("Scenario subscription note");
    await row.getByRole("button", { name: /Save Orchid Cloud details/i }).click();
    await expect(page.getByText("Subscription details saved.")).toBeVisible();

    await row.getByLabel("Confirm archive").check();
    await row.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("Subscription archived.")).toBeVisible();
  });

  test("extra income allocation supports protect all, manual split, deferred review, and privacy", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions?new=1");

    await transactionForm(page).getByLabel("Type").selectOption("income");
    await transactionForm(page).getByLabel("Description").fill("Scenario bonus protected");
    await transactionForm(page).getByLabel("Amount").fill("100.00");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Allocate received income" })).toBeVisible();
    const allocationResults = await new AxeBuilder({ page }).include('section[aria-label="Extra income allocation"]').analyze();
    expect(allocationResults.violations).toEqual([]);

    await page.getByLabel("Protect all").check();
    await page.getByRole("button", { name: "Save allocation" }).click();
    await expect(page.getByText("Extra income allocation saved.")).toBeVisible();

    await page.goto("/#/transactions?new=1");
    await transactionForm(page).getByLabel("Type").selectOption("transfer");
    await transactionForm(page).getByLabel("Description").fill("Scenario bonus protected transfer");
    await transactionForm(page).getByLabel("Amount").fill("100.00");
    await transactionForm(page).getByLabel("To account").selectOption({ label: "Blue Jar Savings" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Link extra income transfer" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm link" }).click();
    await expect(page.getByText("Protected extra-income transfer linked.")).toBeVisible();

    await page.goto("/#/transactions?new=1");
    await transactionForm(page).getByLabel("Type").selectOption("income");
    await transactionForm(page).getByLabel("Description").fill("Scenario bonus split");
    await transactionForm(page).getByLabel("Amount").fill("90.00");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByLabel("Split manually").check();
    await page.getByRole("textbox", { name: "Available", exact: true }).fill("40.00");
    await page.getByRole("textbox", { name: "Protected", exact: true }).fill("50.00");
    await page.getByRole("button", { name: "Save allocation" }).click();
    await expect(page.getByText("Extra income allocation saved.")).toBeVisible();
    await page.getByRole("button", { name: "Edit Scenario bonus split decision" }).click();
    await page.getByLabel("Make all available").check();
    await page.getByRole("button", { name: "Save allocation" }).click();
    await expect(page.getByText("Extra income allocation updated.")).toBeVisible();

    await page.goto("/#/transactions?new=1");
    await transactionForm(page).getByLabel("Type").selectOption("income");
    await transactionForm(page).getByLabel("Description").fill("Scenario bonus deferred");
    await transactionForm(page).getByLabel("Amount").fill("80.00");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Decide later" }).click();
    await expect(page.getByText("Extra income allocation deferred for Daily Review.")).toBeVisible();

    await page.goto("/#/review");
    await expect(page.getByText(/Decide 1 deferred extra-income allocation/i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Decide 1 deferred extra-income allocation/i)).toBeVisible();

    await page.getByRole("button", { name: "Enable privacy mode" }).click();
    await expect(page.getByRole("button", { name: "Disable privacy mode" })).toBeVisible();
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page.locator(".hero-amount")).toContainText("RM");
    await expect(page.locator(".hero-amount")).not.toContainText(/\d/);

    const allocations = await getStoreRecords<{ status: string }>(page, "bluehour-profile-demo", "extraIncomeAllocations");
    expect(allocations.map((allocation) => allocation.status).sort()).toEqual(["available_only", "completed", "deferred"]);
  });
});

function transactionForm(page: Page) {
  return page.locator("section", { hasText: "New transaction" }).locator("form");
}
