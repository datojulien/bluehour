import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { completeLiveOnboarding, getStoreRecords, openDemo, setGoogleSyncState } from "./helpers";

test.describe("production readiness scenarios", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== "chromium", "Production scenario suite runs once on desktop Chromium.");
  });

  test("1. fresh launch welcome screen", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Personal cash-flow planning/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Explore demonstration/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Set up my finances/i })).toBeVisible();
  });

  test("2. demo mode contains fictional records", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions");

    await expect(page.getByText("Vista Heights rent")).toBeVisible();
    await expect(page.getByRole("region", { name: "Transactions" }).getByText("Banyan Market groceries")).toBeVisible();
  });

  test("3. live setup contains no fictional records", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Set up my finances/i }).click();

    await expect(page.getByText("Live setup")).toBeVisible();
    await expect(page.getByText(/Vista Heights|Banyan Market|Orchid Stream/)).toHaveCount(0);
  });

  test("4. demo reset does not alter live data", async ({ page }) => {
    await completeLiveOnboarding(page);
    const liveAccountsBefore = await getStoreRecords(page, "bluehour-profile-live", "accounts");

    await page.getByRole("button", { name: "Welcome" }).click();
    await page.getByRole("button", { name: /Explore demonstration/i }).click();
    await page.getByRole("button", { name: /Reset demo/i }).click();

    const liveAccountsAfter = await getStoreRecords(page, "bluehour-profile-live", "accounts");
    expect(liveAccountsAfter).toHaveLength(liveAccountsBefore.length);
  });

  test("5. live data survives reload", async ({ page }) => {
    await completeLiveOnboarding(page);
    await page.reload();

    await expect(page.locator(".hero-panel")).toBeVisible();
    await expect(await getStoreRecords(page, "bluehour-profile-live", "accounts")).toHaveLength(1);
  });

  test("6. current live date comes from the browser-local clock", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Set up my finances/i }).click();
    const expected = await page.evaluate(() => new Intl.DateTimeFormat("en-GB").format(new Date()));

    await expect(page.getByText(`Today ${expected}`)).toBeVisible();
  });

  test("7. starting first salary cycle avoids salary double-counting", async ({ page }) => {
    await completeLiveOnboarding(page);
    const transactions = await getStoreRecords<{ description: string }>(page, "bluehour-profile-live", "transactions");
    const activeSnapshots = (await getStoreRecords<{ accountId: string; amountMinor: number; archivedAt?: string | null }>(
      page,
      "bluehour-profile-live",
      "balanceSnapshots"
    )).filter((record) => !record.archivedAt);

    expect(transactions.filter((transaction) => transaction.description === "Main salary")).toHaveLength(1);
    expect(activeSnapshots).toContainEqual(expect.objectContaining({ amountMinor: 120_000 }));
  });

  test("8. manual transaction entry", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions?new=1");

    await page.getByLabel("Description").fill("Scenario manual coffee");
    await page.getByLabel("Amount").fill("12.30");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Transaction saved locally.")).toBeVisible();
    await expect(page.getByText("Scenario manual coffee")).toBeVisible();
  });

  test("9. split transaction", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions?new=1");

    await page.getByLabel("Description").fill("Scenario split shop");
    await page.getByLabel("Amount").fill("30.00");
    await page.getByRole("button", { name: /Add split/i }).click();
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Scenario split shop")).toBeVisible();
  });

  test("10. transfer", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions?new=1");

    await page.locator("form.form-grid select").first().selectOption("transfer");
    await page.getByLabel("Description").fill("Scenario wallet top-up");
    await page.getByLabel("Amount").fill("25.00");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Scenario wallet top-up")).toBeVisible();
    await expect(page.locator(".data-row", { hasText: "Scenario wallet top-up" })).toBeVisible();
  });

  test("11. refund linked to original expense", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions?new=1");

    await page.locator("form.form-grid select").first().selectOption("refund");
    await page.getByLabel("Description").fill("Scenario rent refund");
    await page.getByLabel("Amount").fill("20.00");
    await page.getByLabel("Original transaction").selectOption({ label: "Vista Heights rent" });
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Scenario rent refund")).toBeVisible();
  });

  test("12. plan confirmation preserves changed amount and date", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/plan");

    await page.getByRole("button", { name: /Fulfil Insurance premium/i }).click();
    await page.getByLabel("Actual date").fill("2026-07-15");
    await page.getByLabel("Actual amount").fill("175.00");
    await page.getByRole("button", { name: /Confirm actual/i }).click();

    await expect(page.getByText(/Insurance premium fulfilled/i)).toBeVisible();
    await page.goto("/#/review");
    await expect(page.getByText(/variance/i)).toBeVisible();
  });

  test("13. budget overspending and approved transfer", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/budgets");

    await page.getByLabel("Amount").fill("1.00");
    await page.getByLabel("Note").fill("Scenario approved transfer");
    await page.getByRole("button", { name: /Move budget/i }).click();

    await expect(page.getByText("Budget transfer saved. No account transaction was created.")).toBeVisible();
  });

  test("14. CSV mapping preview", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions");

    await page.getByRole("button", { name: /^Import$/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "scenario.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,description,amount,reference\n2026-07-12,Scenario import,-8.50,IMP-1\n")
    });
    await page.getByLabel("UTF-8 confirmed").check();

    await expect(page.getByText(/1 row ready for local preview/i)).toBeVisible();
  });

  test("15. uncertain duplicate review survives reload", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions");

    await page.getByRole("button", { name: /^Import$/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "uncertain.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,description,amount,reference\n2026-06-26,Vista rent,-2200.00,UNCERTAIN-1\n")
    });
    await page.getByLabel("UTF-8 confirmed").check();
    await page.getByRole("button", { name: /Analyse and import/i }).click();
    await expect(page.getByText(/uncertain matches saved for review/i)).toBeVisible();
    await page.reload();
    await page.goto("/#/review");

    await expect(page.getByText(/Uncertain duplicate rows/i)).toBeVisible();
  });

  test("16. weekly reconciliation", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/review");

    await page.getByLabel("Harbour Wallet institution balance").fill("22.00");
    await page.getByLabel("Harbour Wallet reconciliation note").fill("Scenario wallet reconciliation");
    await page.getByRole("button", { name: /Save reconciliation for Harbour Wallet/i }).click();

    await expect(page.getByText("Reconciliation saved.")).toBeVisible();
  });

  test("17. cycle close", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/review");

    await page.getByRole("button", { name: /Create checklist/i }).click();
    await page.getByRole("button", { name: /Reconcile all enabled accounts/i }).click();
    await page.getByLabel("Salary deposit").fill("7900.00");
    await page.getByLabel("Reconciliation skip note").fill("Scenario explicit skip after review");
    await page.getByRole("button", { name: /Close cycle/i }).click();

    await expect(page.getByText("Salary cycle closed and the next cycle budget template was created.")).toBeVisible();
  });

  test("18. privacy mode obscures amounts", async ({ page }) => {
    await openDemo(page);
    await expect(page.getByText(/RM[0-9,]+\.[0-9]{2}/).first()).toBeVisible();

    await page.getByRole("button", { name: /Enable privacy mode/i }).click();

    await expect(page.getByText("RM••••••").first()).toBeVisible();
  });

  test("19. offline/local transaction enters the live outbox", async ({ page }) => {
    await completeLiveOnboarding(page);
    await page.goto("/#/transactions?new=1");

    await page.getByLabel("Description").fill("Scenario live local expense");
    await page.getByLabel("Amount").fill("9.90");
    await page.getByRole("button", { name: "Save" }).click();

    const outbox = await getStoreRecords(page, "bluehour-profile-live", "outboxOperations");
    expect(outbox.length).toBeGreaterThan(0);
    await expect(page.getByText(/waiting to sync/i)).toBeVisible();
  });

  test("20. reconnection state remains locally usable", async ({ page }) => {
    await completeLiveOnboarding(page);
    await setGoogleSyncState(page, "needs_reconnection", "Reconnect required for Google Sheets.");
    await page.reload();

    await expect(page.getByText("Reconnect required for Google Sheets.")).toBeVisible();
    await page.goto("/#/transactions?new=1");
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });

  test("21. Google sync UI uses mocked APIs", async ({ page }) => {
    await page.addInitScript(() => {
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: (config) => ({
              requestAccessToken: () => config.callback({ access_token: "mock-token" })
            })
          }
        }
      };
    });
    await page.route("https://sheets.googleapis.com/v4/spreadsheets", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ spreadsheetId: "mock-sheet-id" }) });
    });
    await completeLiveOnboarding(page);
    await page.goto("/#/settings");
    await page.getByRole("button", { name: /Create Sheet/i }).click();

    await expect(page.getByText(/Google Sheet created/i)).toBeVisible();
  });

  test("22. encrypted backup and restore", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/settings");

    await page.getByLabel("Passphrase").fill("test-passphrase");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Download encrypted backup/i }).click();
    const download = await downloadPromise;
    const backupText = await readFile(await download.path() ?? "", "utf8");

    await page.getByLabel("Restore envelope").fill(backupText);
    await page.getByLabel(/Replace this Fictional demonstration/i).check();
    await page.getByRole("button", { name: /Restore backup/i }).click();

    await expect(page.getByText("Backup decrypted and restored.")).toBeVisible();
  });

  test("23. installable app manifest and icons are available", async ({ page }) => {
    const manifestResponse = await page.request.get("/manifest.webmanifest");
    const appleIconResponse = await page.request.get("/apple-touch-icon.png");
    const manifest = (await manifestResponse.json()) as { display: string; start_url: string; scope: string; icons: Array<{ src: string }> };

    expect(manifestResponse.ok()).toBe(true);
    expect(appleIconResponse.ok()).toBe(true);
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe(".");
    expect(manifest.scope).toBe(".");
    expect(manifest.icons.map((icon) => icon.src)).toEqual(expect.arrayContaining(["icon.svg", "icon-192.png", "icon-512.png"]));
  });

  test("24. keyboard shortcuts and Escape close command UI", async ({ page }) => {
    await openDemo(page);

    await page.keyboard.press("Meta+K");
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command menu" })).toHaveCount(0);
    await page.keyboard.press("Meta+N");
    await expect(page.getByRole("heading", { name: /New transaction/i })).toBeVisible();
  });

  test("25. narrow responsive navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page);

    await page.getByRole("button", { name: /More/i }).click();

    await expect(page.getByRole("button", { name: /Net Worth/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  });
});
