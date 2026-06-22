import { expect, test } from "@playwright/test";
import { completeLiveOnboarding, getStoreRecords, mockDriveAppDataVault, mockGoogleIdentity } from "./helpers";

test("fresh launch shows the welcome chooser", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Personal cash-flow planning/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Explore demonstration/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Set up locally first/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
});

test("demo mode opens fictional data and disables Google sync", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Explore demonstration/i }).click();

  await expect(page.locator(".brand-state:visible, .topbar-profile-label:visible")).toBeVisible();
  await page.goto("/#/transactions");
  await expect(page.getByText("Vista Heights rent")).toBeVisible();

  await page.goto("/#/settings");
  await expect(page.getByText(/Google sync is disabled for the fictional demonstration profile/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Create Sheet export/i })).toBeDisabled();
});

test("continue with Google creates a Drive vault for a fresh browser", async ({ page }) => {
  await mockGoogleIdentity(page);
  await mockDriveAppDataVault(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Continue with Google/i }).click();

  await expect(page.getByRole("heading", { name: /Continue with Google/i })).toBeVisible();
  await page.getByRole("button", { name: /Continue with Google/i }).click();
  await expect(page.getByRole("heading", { name: "Google", exact: true })).toBeVisible();
  await expect(page.getByText(/Saved to Google Drive/i)).toBeVisible();
});

test("live setup starts empty and uses the current setup flow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Set up locally first/i }).click();

  await expect(page.getByText("Live setup")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google", exact: true })).toBeVisible();
  await expect(page.getByText(/Vista Heights|Banyan Market|Orchid Stream/)).toHaveCount(0);
});

test("live changes auto-sync during an active Google session", async ({ page }) => {
  await mockGoogleIdentity(page);
  await mockDriveAppDataVault(page);
  await completeLiveOnboarding(page);
  await page.goto("/#/settings");
  await page.getByRole("button", { name: /Sync Drive vault/i }).click();
  await expect(page.getByRole("main").getByText(/Google Drive vault created and local profile pushed/i)).toBeVisible();
  await expect(page.getByText(/Active until/i)).toBeVisible();
  const tokenRequestsAfterManualSync = await page.evaluate(() => window.__bluehourGoogleTokenRequests ?? 0);

  await page.goto("/#/transactions?new=1");
  await page.getByLabel("Description").fill("Session auto-sync coffee");
  await page.getByLabel("Amount").fill("8.80");
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(async () => (await getStoreRecords(page, "bluehour-profile-live", "outboxOperations")).length).toBe(0);
  await expect.poll(async () => (await getStoreRecords<{ status: string; message?: string }>(page, "bluehour-profile-live", "syncState"))[0]?.status).toBe("synced");
  await expect
    .poll(async () => (await getStoreRecords<{ status: string; message?: string }>(page, "bluehour-profile-live", "syncState"))[0]?.message)
    .toContain("Auto-synced to Google Drive");
  expect(await page.evaluate(() => window.__bluehourGoogleTokenRequests ?? 0)).toBe(tokenRequestsAfterManualSync);
});

test("mobile navigation exposes remaining destinations through More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Explore demonstration/i }).click();

  await page.getByRole("button", { name: /More/i }).click();
  await expect(page.getByRole("button", { name: /Net Worth/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
});
