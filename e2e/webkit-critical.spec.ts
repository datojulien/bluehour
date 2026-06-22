import { expect, test } from "@playwright/test";
import { openDemo, completeLiveOnboarding, getStoreRecords } from "./helpers";

test.describe("WebKit critical flows", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== "webkit", "Critical Safari-style coverage runs on the WebKit project.");
  });

  test("fresh launch, demo selection, cross-salary dashboard, privacy mode, and responsive navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Personal cash-flow planning/i })).toBeVisible();

    await page.getByRole("button", { name: /Explore demonstration/i }).click();
    await expect(page.locator(".hero-panel")).toBeVisible();
    await expect(page.getByText(/Projected main salary/i)).toBeVisible();

    await page.getByRole("button", { name: /Enable privacy mode/i }).click();
    await expect(page.getByText("RM••••••").first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /More/i }).click();
    await expect(page.getByRole("button", { name: /Net Worth/i })).toBeVisible();
  });

  test("live setup, reload persistence, and transaction creation", async ({ page }) => {
    await completeLiveOnboarding(page);
    await page.reload();
    await expect(page.locator(".hero-panel")).toBeVisible();

    await page.goto("/#/transactions?new=1");
    await page.getByLabel("Description").fill("WebKit local expense");
    await page.getByLabel("Amount").fill("9.90");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("WebKit local expense")).toBeVisible();
    const transactions = await getStoreRecords<{ description: string }>(page, "bluehour-profile-live", "transactions");
    expect(transactions.map((transaction) => transaction.description)).toContain("WebKit local expense");
  });

  test("CSV mapping, import audit review, backup export, and offline shell relaunch", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions");

    await page.getByRole("button", { name: /^Import$/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "webkit-uncertain.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,description,amount,reference\n2026-06-25,Ambiguous duplicate,-2200.00,\n")
    });
    await page.getByLabel("UTF-8 confirmed").check();
    await page.getByRole("button", { name: /Analyse and import/i }).click();
    await expect(page.getByText(/uncertain matches saved for review/i)).toBeVisible();

    await page.goto("/#/review");
    await expect(page.getByRole("heading", { name: /Uncertain duplicate rows/i })).toBeVisible();

    await page.goto("/#/settings");
    await page.getByLabel("Passphrase").fill("webkit-passphrase");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Download encrypted backup/i }).click();
    await downloadPromise;

    await page.reload();
    await expect(page.getByText(/Fictional demonstration/i).first()).toBeVisible();
  });
});
