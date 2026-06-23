import { expect, test } from "@playwright/test";
import {
  completeLiveOnboarding,
  getStoreRecords,
  mockDriveAppDataVault,
  mockGoogleIdentity,
  seedOpenCycleMismatch
} from "./helpers";

test.describe("Profile Health and Drive vault repair", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name === "mobile", "Profile Health repair coverage runs on desktop browsers.");
  });

  test("open-cycle mismatch shows a repair panel and can resume as live", async ({ page }) => {
    await seedOpenCycleMismatch(page);

    await expect(page.getByRole("heading", { name: "A salary cycle already exists" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start first salary cycle" })).toHaveCount(0);

    await page.getByRole("button", { name: "Resume as live profile" }).click();
    await expect(page.locator(".hero-panel")).toBeVisible();

    const settings = await getStoreRecords<{ key: string; valueJson: string }>(page, "bluehour-profile-live", "settings");
    const manifest = JSON.parse(settings.find((setting) => setting.key === "profileManifest")?.valueJson ?? "{}") as { lifecycle?: string };
    const openCycles = (await getStoreRecords<{ status: string; archivedAt?: string | null }>(page, "bluehour-profile-live", "budgetCycles")).filter(
      (cycle) => cycle.status === "open" && !cycle.archivedAt
    );

    expect(manifest.lifecycle).toBe("live");
    expect(openCycles).toHaveLength(1);
  });

  test("archive accidental cycle requires confirmation and returns to start-cycle setup", async ({ page }) => {
    await seedOpenCycleMismatch(page);

    const archiveButton = page.getByRole("button", { name: "Archive accidental cycle" });
    await expect(archiveButton).toBeDisabled();
    await page.getByLabel(/I understand this archives the accidental first-cycle records/i).check();
    await expect(archiveButton).toBeEnabled();
    await archiveButton.click();

    await expect(page.getByRole("heading", { name: "Start first salary cycle" })).toBeVisible();
    const openCycles = (await getStoreRecords<{ status: string; archivedAt?: string | null }>(page, "bluehour-profile-live", "budgetCycles")).filter(
      (cycle) => cycle.status === "open" && !cycle.archivedAt
    );
    const archivedSalary = (await getStoreRecords<{ description: string; archivedAt?: string | null }>(page, "bluehour-profile-live", "transactions")).filter(
      (transaction) => transaction.description === "Main salary" && transaction.archivedAt
    );

    expect(openCycles).toHaveLength(0);
    expect(archivedSalary).toHaveLength(1);
  });

  test("settings Profile Health shows counts and Drive vault reset requires the exact phrase", async ({ page }) => {
    await mockGoogleIdentity(page);
    await mockDriveAppDataVault(page);
    await completeLiveOnboarding(page);
    const accountsBefore = await getStoreRecords(page, "bluehour-profile-live", "accounts");
    await page.goto("/#/settings");
    await page.getByRole("button", { name: "Sync Drive vault" }).click();
    await expect(page.getByRole("main").getByText(/Google Drive vault created and local profile pushed/i)).toBeVisible();

    const healthPanel = page.locator("#profile-health");
    await expect(healthPanel.getByText("Manifest lifecycle")).toBeVisible();
    await expect(healthPanel.getByText("Open salary cycles")).toBeVisible();
    await expect(healthPanel.getByText("Pending local changes")).toBeVisible();

    const resetButton = page.getByRole("button", { name: "Reset hidden Google Drive vault" });
    await expect(resetButton).toBeDisabled();
    await page.getByLabel("Type RESET GOOGLE VAULT").fill("RESET GOOGLE VAULT");
    await expect(resetButton).toBeEnabled();
    await resetButton.click();

    await expect(page.getByRole("main").getByText(/Reconnect Google to create a new vault/i)).toBeVisible();
    const settings = await getStoreRecords<{ key: string; archivedAt?: string | null }>(page, "bluehour-profile-live", "settings");
    const syncState = await getStoreRecords<{ status: string }>(page, "bluehour-profile-live", "syncState");

    expect(settings.filter((setting) => setting.key === "googleConnection" && !setting.archivedAt)).toHaveLength(0);
    expect(syncState[0]?.status).toBe("saved_locally");
    expect(await getStoreRecords(page, "bluehour-profile-live", "accounts")).toHaveLength(accountsBefore.length);
  });

  test("Continue with Google explains no Sheet is expected and repairs setup-plus-open as live", async ({ page }) => {
    await mockGoogleIdentity(page);
    await mockDriveAppDataVault(page, {
      existingRemote: true,
      lifecycle: "setup",
      onboardingStep: "start_cycle",
      openCycleCount: 1
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Continue with Google/i }).click();

    await expect(page.getByText(/A Google Sheet is not created unless you explicitly export one/i)).toBeVisible();
    await page.getByRole("button", { name: /Continue with Google/i }).click();
    await expect(page.getByText("A salary cycle already exists")).toBeVisible();
    await page.getByRole("button", { name: "Restore and repair as live" }).click();

    await expect(page.locator(".hero-panel")).toBeVisible();
    const settings = await getStoreRecords<{ key: string; valueJson: string }>(page, "bluehour-profile-live", "settings");
    const manifest = JSON.parse(settings.find((setting) => setting.key === "profileManifest")?.valueJson ?? "{}") as { lifecycle?: string };
    const syncState = await getStoreRecords<{ status: string; remoteRevision?: number }>(page, "bluehour-profile-live", "syncState");

    expect(manifest.lifecycle).toBe("live");
    expect(syncState[0]).toMatchObject({ status: "synced", remoteRevision: 15 });
  });

  test("remote multiple-open-cycle vault restores read-only instead of auto-repairing", async ({ page }) => {
    await mockGoogleIdentity(page);
    await mockDriveAppDataVault(page, {
      existingRemote: true,
      lifecycle: "live",
      openCycleCount: 2
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Continue with Google/i }).click();
    await page.getByRole("button", { name: /Continue with Google/i }).click();

    await expect(page.getByText("Multiple open salary cycles")).toBeVisible();
    await page.getByRole("button", { name: "Restore read-only" }).click();
    await expect(page.getByRole("heading", { name: "Read-only recovery" })).toBeVisible();
  });

  test("recovery Drive vault reset requires RESET GOOGLE VAULT and preserves local browser data", async ({ page }) => {
    await mockGoogleIdentity(page);
    await mockDriveAppDataVault(page, { existingRemote: true, lifecycle: "live", openCycleCount: 1 });
    await completeLiveOnboarding(page);
    const accountsBefore = await getStoreRecords(page, "bluehour-profile-live", "accounts");

    await page.getByRole("button", { name: "Welcome" }).click();
    await page.getByRole("button", { name: /Continue with Google/i }).click();
    await page.getByRole("button", { name: /Continue with Google/i }).click();

    const resetButton = page.getByRole("button", { name: "Reset hidden Google Drive vault" });
    await expect(resetButton).toBeDisabled();
    await page.getByLabel("Type RESET GOOGLE VAULT").fill("RESET GOOGLE VAULT");
    await expect(resetButton).toBeEnabled();
    await resetButton.click();

    await expect(page.getByText(/Hidden Google Drive vault reset/i)).toBeVisible();
    expect(await getStoreRecords(page, "bluehour-profile-live", "accounts")).toHaveLength(accountsBefore.length);
  });
});
