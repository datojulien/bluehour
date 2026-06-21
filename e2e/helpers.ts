import { expect, type Page } from "@playwright/test";

export async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Explore demonstration/i }).click();
  await expect(page.locator(".brand-state:visible, .topbar-profile-label:visible")).toBeVisible();
}

export async function completeLiveOnboarding(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Set up my finances/i }).click();
  await page.getByRole("button", { name: /Defer Google for now/i }).click();
  await page.getByRole("button", { name: /Save preferences/i }).click();

  await page.getByLabel("Name").fill("Daily Current");
  await page.getByLabel("Opening value").fill("1200.00");
  await page.getByLabel("Institution label").fill("Test Bank");
  await page.getByRole("button", { name: /Save and continue/i }).click();

  await page.getByRole("button", { name: /Skip for now/i }).click();
  await page.getByRole("button", { name: /Skip for now/i }).click();
  await page.getByRole("button", { name: /Save budget template/i }).click();
  await page.getByRole("button", { name: /Salary has arrived/i }).click();

  await page.getByLabel("Salary deposit").fill("7800.00");
  await page.getByLabel("Current balance").fill("9000.00");
  await page.getByRole("button", { name: /Start live profile/i }).click();
  await expect(page.locator(".hero-panel")).toBeVisible();
}

export async function getStoreRecords<T = unknown>(page: Page, dbName: string, storeName: string): Promise<T[]> {
  return page.evaluate(
    async ({ dbName: requestedDbName, storeName: requestedStoreName }) =>
      new Promise<T[]>((resolve, reject) => {
        const request = indexedDB.open(requestedDbName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(requestedStoreName, "readonly");
          const getAll = tx.objectStore(requestedStoreName).getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => resolve(getAll.result as T[]);
          tx.oncomplete = () => db.close();
        };
      }),
    { dbName, storeName }
  );
}

export async function setGoogleSyncState(page: Page, status: string, message: string) {
  await page.evaluate(
    async ({ status: nextStatus, message: nextMessage }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("bluehour-profile-live");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("syncState", "readwrite");
          tx.objectStore("syncState").put({ key: "google", status: nextStatus, message: nextMessage });
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { status, message }
  );
}
