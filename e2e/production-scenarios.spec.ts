import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { completeLiveOnboarding, getStoreRecords, mockDriveAppDataVault, mockGoogleIdentity, openDemo, setGoogleSyncState } from "./helpers";

test.describe("production readiness scenarios", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== "chromium", "Production scenario suite runs once on desktop Chromium.");
  });

  test("1. fresh launch welcome screen", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Personal cash-flow planning/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Explore demonstration/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Set up locally first/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });

  test("2. demo mode contains fictional records", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions");

    await expect(page.getByText("Vista Heights rent")).toBeVisible();
    await expect(page.getByRole("region", { name: "Transactions" }).getByText("Banyan Market groceries")).toBeVisible();
  });

  test("3. live setup contains no fictional records", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Set up locally first/i }).click();

    await expect(page.getByText("Live setup")).toBeVisible();
    await expect(page.getByText(/Saved on this device only/i)).toBeVisible();
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
    await page.getByRole("button", { name: /Set up locally first/i }).click();
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

    await page.getByRole("button", { name: "Edit Scenario manual coffee" }).click();
    const editForm = page.locator("section", { hasText: "Edit transaction" }).locator("form");
    await editForm.getByLabel("Amount").fill("13.40");
    await editForm.getByLabel("Date").fill("2026-07-05");
    await editForm.getByLabel("Category").selectOption({ label: "Dining Out" });
    await editForm.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Transaction updated.")).toBeVisible();
    const editedRow = page.getByRole("region", { name: "Transactions" }).locator(".data-row", { hasText: "Scenario manual coffee" });
    await expect(editedRow).toContainText("05/07/2026");
    await expect(editedRow).toContainText("Dining Out");
    await expect(editedRow).toContainText("RM13.40");

    const transactions = await getStoreRecords<{ id: string; description: string }>(page, "bluehour-profile-demo", "transactions");
    const edited = transactions.find((transaction) => transaction.description === "Scenario manual coffee");
    expect(edited).toBeTruthy();
    const splits = await getStoreRecords<{ transactionId: string; categoryId: string; amountMinor: number; archivedAt?: string | null }>(
      page,
      "bluehour-profile-demo",
      "transactionSplits"
    );
    expect(splits.filter((split) => split.transactionId === edited?.id && !split.archivedAt)).toEqual([
      expect.objectContaining({ categoryId: "cat-dining", amountMinor: 1_340 })
    ]);
    expect(splits.some((split) => split.transactionId === edited?.id && split.archivedAt)).toBe(true);
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
      buffer: Buffer.from("date,description,amount,reference\n2026-06-25,Ambiguous duplicate,-2200.00,\n")
    });
    await page.getByLabel("UTF-8 confirmed").check();
    await page.getByRole("button", { name: /Analyse and import/i }).click();
    await expect(page.getByText(/uncertain matches saved for review/i)).toBeVisible();
    await page.reload();
    await page.goto("/#/review");

    await expect(page.getByText(/Uncertain duplicate rows/i)).toBeVisible();
  });

  test("26. user can link an uncertain imported row", async ({ page }) => {
    await importUncertainDuplicate(page, "link-uncertain.csv");
    await page.goto("/#/review");

    await page.getByRole("button", { name: /Link imported row Ambiguous duplicate/i }).first().click();

    await expect(page.getByText("Import row linked to an existing transaction.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Ambiguous duplicate")).toHaveCount(0);
  });

  test("27. user can create an uncertain imported row as new", async ({ page }) => {
    await importUncertainDuplicate(page, "create-uncertain.csv");
    await page.goto("/#/review");

    await page.getByRole("button", { name: "Create new" }).click();

    await expect(page.getByText("Import row created as a new transaction.")).toBeVisible();
    await page.goto("/#/transactions");
    await expect(page.locator(".data-row", { hasText: "Ambiguous duplicate" }).first()).toBeVisible();
  });

  test("28. user can ignore an uncertain imported row", async ({ page }) => {
    await importUncertainDuplicate(page, "ignore-uncertain.csv");
    await page.goto("/#/review");

    await page.getByRole("button", { name: "Ignore" }).click();

    await expect(page.getByText("Import row ignored.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Ambiguous duplicate")).toHaveCount(0);
  });

  test("29. re-importing the same file requires deliberate confirmation", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions");
    const file = Buffer.from("date,description,amount,reference\n2026-07-12,Scenario import,-8.50,REIMPORT-1\n");

    await page.getByRole("button", { name: /^Import$/i }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "reimport.csv", mimeType: "text/csv", buffer: file });
    await page.getByLabel("UTF-8 confirmed").check();
    await page.getByRole("button", { name: /Analyse and import/i }).click();
    await expect(page.getByText(/Imported 1 new rows/i)).toBeVisible();

    await page.getByRole("button", { name: /^Import$/i }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "reimport.csv", mimeType: "text/csv", buffer: file });
    await page.getByLabel("UTF-8 confirmed").check();
    await page.getByRole("button", { name: /Analyse and import/i }).click();

    await expect(page.locator(".form-error", { hasText: /previously imported/i })).toBeVisible();
  });

  test("30. rollback archives only newly created import transactions", async ({ page }) => {
    await openDemo(page);
    await page.goto("/#/transactions");
    const file = Buffer.from(
      [
        "date,description,amount,reference",
        "2026-07-12,Rollback imported expense,-7.77,ROLLBACK-NEW",
        "2026-06-25,Ambiguous duplicate,-2200.00,"
      ].join("\n")
    );

    await page.getByRole("button", { name: /^Import$/i }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "mixed-rollback.csv", mimeType: "text/csv", buffer: file });
    await page.getByLabel("UTF-8 confirmed").check();
    await page.getByRole("button", { name: /Analyse and import/i }).click();
    await expect(page.getByText(/Imported 1 new rows\. 0 strong duplicates linked\. 1 uncertain matches saved for review\./i)).toBeVisible();

    await page.goto("/#/review");
    await page.getByRole("button", { name: /Link imported row Ambiguous duplicate/i }).first().click();
    await expect(page.getByText("Import row linked to an existing transaction.")).toBeVisible();

    await page.goto("/#/transactions");
    const transactionRegion = page.getByRole("region", { name: "Transactions" });
    await expect(transactionRegion.locator(".data-row", { hasText: "Rollback imported expense" })).toBeVisible();
    await page.getByRole("button", { name: "Roll back" }).click();
    await page.getByRole("button", { name: "Confirm rollback" }).click();

    await expect(page.getByText(/Archived 1 imported transaction from mixed-rollback\.csv\./i)).toBeVisible();
    const transactions = await getStoreRecords<{ description: string; archivedAt?: string | null }>(page, "bluehour-profile-demo", "transactions");
    expect(transactions.filter((transaction) => transaction.description === "Rollback imported expense" && !transaction.archivedAt)).toHaveLength(0);
    expect(transactions.filter((transaction) => transaction.description === "Vista Heights rent" && !transaction.archivedAt)).toHaveLength(1);

    const audits = await getStoreRecords<{
      description: string;
      outcome: string;
      linkedTransactionId?: string;
      rollbackNote?: string;
      rolledBackAt?: string;
    }>(page, "bluehour-profile-demo", "importRowAudits");
    const batchAudits = audits.filter((audit) => audit.description === "Rollback imported expense" || audit.description === "Ambiguous duplicate");
    expect(batchAudits).toHaveLength(2);
    expect(batchAudits.every((audit) => audit.rolledBackAt && audit.rollbackNote?.includes("only transactions created by this batch"))).toBe(true);
    expect(batchAudits.some((audit) => audit.outcome === "user_linked" && audit.linkedTransactionId)).toBe(true);
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
    await setGoogleSyncState(page, "needs_reconnection", "Reconnect required for Google Drive vault.");
    await page.reload();

    await expect(page.getByText("Reconnect required for Google Drive vault.")).toBeVisible();
    await page.goto("/#/transactions?new=1");
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });

  test("21. Google sync UI uses mocked APIs", async ({ page }) => {
    await mockGoogleIdentity(page);
    await mockDriveAppDataVault(page);
    await completeLiveOnboarding(page);
    await page.goto("/#/settings");
    await page.getByRole("button", { name: /Sync Drive vault/i }).click();

    await expect(page.getByRole("main").getByText(/Google Drive vault created and local profile pushed/i)).toBeVisible();
  });

  test("31. Continue with Google shows a remote profile preview", async ({ page }) => {
    await mockGoogleIdentity(page);
    await mockDriveAppDataVault(page, { existingRemote: true, remoteRevision: 14, onboardingStep: "budget" });

    await page.goto("/");
    await page.getByRole("button", { name: /Continue with Google/i }).click();
    await page.getByRole("button", { name: /Continue with Google/i }).click();

    await expect(page.getByText("Google Drive vault found. Preview it before setting up this browser.")).toBeVisible();
    await expect(page.getByLabel("Google Drive vault preview").getByText("Personal finances")).toBeVisible();
    await expect(page.getByText(/Remote revision/i)).toBeVisible();
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

    await page.keyboard.press("ControlOrMeta+K");
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command menu" })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+N");
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

async function importUncertainDuplicate(page: Page, fileName: string) {
  await openDemo(page);
  await page.goto("/#/transactions");
  await page.getByRole("button", { name: /^Import$/i }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from("date,description,amount,reference\n2026-06-25,Ambiguous duplicate,-2200.00,\n")
  });
  await page.getByLabel("UTF-8 confirmed").check();
  await page.getByRole("button", { name: /Analyse and import/i }).click();
  await expect(page.getByText(/1 uncertain matches saved for review/i)).toBeVisible();
}
