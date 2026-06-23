import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectReadableFormControls, openDemo } from "./helpers";

test.describe("form control layout", () => {
  test("budget allocation edit fields stay readable across desktop and tablet widths", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop layout coverage runs once on Chromium.");

    await openDemo(page);

    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/#/budgets");

      await expectBudgetAllocationControl(page);
      await expectReadableFormControls(page);
    }
  });

  test("subscription price update field stays readable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop layout coverage runs once on Chromium.");

    await openDemo(page);
    await page.goto("/#/subscriptions");

    const price = page.locator(".data-row", { hasText: "Orchid Cloud" }).getByLabel("New subscription price");
    await price.fill("99999.99");
    await expect(price).toHaveValue("99999.99");
    await expectControlWidth(price, 80);
    await expectReadableFormControls(page);
  });

  test("transaction amount field stays readable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop layout coverage runs once on Chromium.");

    await openDemo(page);
    await page.goto("/#/transactions?new=1");

    const amount = page.locator("section", { hasText: "New transaction" }).locator("form").getByLabel("Amount");
    await amount.fill("99999.99");
    await expect(amount).toHaveValue("99999.99");
    await expectControlWidth(amount, 80);
    await expectReadableFormControls(page);
  });

  test("plan amount field stays readable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop layout coverage runs once on Chromium.");

    await openDemo(page);
    await page.goto("/#/plan");

    const amount = page
      .getByRole("heading", { name: "Planned item", exact: true })
      .locator("xpath=ancestor::section[1]")
      .locator("form")
      .getByLabel("Amount");
    await amount.fill("99999.99");
    await expect(amount).toHaveValue("99999.99");
    await expectControlWidth(amount, 80);
    await expectReadableFormControls(page);
  });

  test("category manager edit field stays readable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop layout coverage runs once on Chromium.");

    await openDemo(page);
    await page.goto("/#/settings#categories");

    const categoryName = page.locator("#categories .category-table").getByRole("textbox", { name: /name$/ }).first();
    await categoryName.fill("Scenario readable category");
    await expect(categoryName).toHaveValue("Scenario readable category");
    await expectControlWidth(categoryName, 120);
    await expectReadableFormControls(page);
  });

  test("Savings Coach purchase amount field stays readable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop layout coverage runs once on Chromium.");

    await openDemo(page);
    await page.goto("/#/coach");

    const amount = page.locator("#purchase").getByLabel("Amount");
    await amount.fill("99999.99");
    await expect(amount).toHaveValue("99999.99");
    await expectControlWidth(amount, 80);
    await expectReadableFormControls(page);
  });

  test("mobile budget table scrolls instead of crushing edit fields", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile budget table coverage runs on the mobile project.");

    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page);
    await page.goto("/#/budgets");

    const table = page.getByRole("region", { name: "Budget allocations" });
    const metrics = await table.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 100);

    const pageMetrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.scrollingElement?.scrollWidth ?? document.body.scrollWidth
    }));
    expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.viewportWidth + 2);

    await expectBudgetAllocationControl(page);
    await expectReadableFormControls(page);
  });

  test("WebKit budget table keeps allocation edits readable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "webkit", "WebKit budget table coverage runs on the WebKit project.");

    await page.setViewportSize({ width: 1024, height: 768 });
    await openDemo(page);
    await page.goto("/#/budgets");

    await expectBudgetAllocationControl(page);
    await expectReadableFormControls(page);
  });
});

async function expectBudgetAllocationControl(page: Page) {
  const table = page.getByRole("region", { name: "Budget allocations" });
  const allocation = table.locator('input[inputmode="decimal"]').first();
  await expect(allocation).toBeVisible();
  await expect(allocation).toHaveValue("2200.00");
  await expectControlWidth(allocation, 88);
  await allocation.fill("2200.00");
  await expect(allocation).toHaveValue("2200.00");
  await expect(
    allocation.locator("xpath=ancestor::form[1]").getByRole("button", { name: /Save .* allocation/i })
  ).toBeVisible();
}

async function expectControlWidth(locator: Locator, minimumWidth: number) {
  const box = await locator.boundingBox();
  expect(box, "control should have a bounding box").not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(minimumWidth);
}
