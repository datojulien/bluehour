import { expect, test } from "@playwright/test";

test("fresh launch shows the welcome chooser", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Personal cash-flow planning/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Explore demonstration/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Set up new finances/i })).toBeVisible();
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
  await expect(page.getByRole("button", { name: /Create Sheet/i })).toBeDisabled();
});

test("continue-existing flow validates a Sheet ID before restore", async ({ page }) => {
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
  await page.route(/https:\/\/www\.googleapis\.com\/drive\/v3\/files.*/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: [] }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Continue with Google/i }).click();

  await expect(page.getByRole("heading", { name: /Continue with Google/i })).toBeVisible();
  await page.getByRole("button", { name: /Continue with Google/i }).click();
  await expect(page.getByText(/could not find an app-accessible Sheet/i)).toBeVisible();
  await page.getByLabel("Sheet link or ID fallback").fill("bad");
  await page.getByRole("button", { name: /Inspect profile/i }).click();
  await expect(page.getByText("Enter a valid Google Sheet URL or spreadsheet ID.")).toBeVisible();
});

test("live setup starts empty and uses the current setup flow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Set up new finances/i }).click();

  await expect(page.getByText("Live setup")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google", exact: true })).toBeVisible();
  await expect(page.getByText(/Vista Heights|Banyan Market|Orchid Stream/)).toHaveCount(0);
});

test("mobile navigation exposes remaining destinations through More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Explore demonstration/i }).click();

  await page.getByRole("button", { name: /More/i }).click();
  await expect(page.getByRole("button", { name: /Net Worth/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
});
