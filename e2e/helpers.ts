import { expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    __bluehourGoogleTokenRequests?: number;
  }
}

export async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Explore demonstration/i }).click();
  await expect(page.locator(".brand-state:visible, .topbar-profile-label:visible")).toBeVisible();
}

export async function advanceLiveOnboardingToStartCycle(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Set up locally first/i }).click();
  await page.getByRole("button", { name: /Defer Google for now/i }).click();
  await page.getByRole("button", { name: /Save preferences/i }).click();

  await page.getByLabel("Name").fill("Daily Current");
  await page.getByLabel("Opening value").fill("1200.00");
  await page.getByLabel("Institution label").fill("Test Bank");
  await page.getByRole("button", { name: /Save and continue/i }).click();

  await page.getByLabel("Amount").fill("7800.00");
  await page.getByRole("button", { name: /Save income/i }).click();
  await expect(page.getByRole("heading", { name: "Obligations", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Skip for now/i }).click();
  await expect(page.getByRole("heading", { name: "Budget", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Accept suggested budget/i }).click();
  await expect(page.getByRole("heading", { name: "Wait salary", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Salary has arrived/i }).click();
  await expect(page.getByRole("heading", { name: "Start cycle", exact: true })).toBeVisible();
}

export async function completeLiveOnboarding(page: Page) {
  await advanceLiveOnboardingToStartCycle(page);

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

export async function patchShellState(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(
    async (nextPatch) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("bluehour-shell", 2);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("shellState")) {
            db.createObjectStore("shellState", { keyPath: "key" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("shellState", "readwrite");
          const store = tx.objectStore("shellState");
          const getRequest = store.get("state");
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => {
            store.put({
              ...(getRequest.result ?? { key: "state", legacyDatabaseDetected: false }),
              ...nextPatch,
              key: "state",
              updatedAt: new Date().toISOString()
            });
          };
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    patch
  );
}

export async function seedOpenCycleMismatch(page: Page, openCycleCount = 1) {
  await advanceLiveOnboardingToStartCycle(page);
  await page.evaluate(
    async (count) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("bluehour-profile-live");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(
            ["accounts", "balanceSnapshots", "transactions", "transactionLegs", "transactionSplits", "budgetCycles", "budgetAllocations"],
            "readwrite"
          );
          const accountRequest = tx.objectStore("accounts").getAll();
          accountRequest.onerror = () => reject(accountRequest.error);
          accountRequest.onsuccess = () => {
            const account = (accountRequest.result as Array<{ id: string }>)[0];
            if (!account) {
              reject(new Error("Expected an onboarding account before seeding profile health mismatch"));
              return;
            }
            const now = new Date().toISOString();
            for (let index = 0; index < count; index += 1) {
              const suffix = index === 0 ? "one" : `extra-${index}`;
              const transactionId = `txn-profile-health-${suffix}`;
              const cycleId = `cycle-profile-health-${suffix}`;
              tx.objectStore("transactions").put({
                id: transactionId,
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
                revision: 1,
                type: "income",
                status: "actual",
                occurredOn: "2026-07-24",
                description: "Main salary",
                merchantNormalized: "main salary",
                source: "manual"
              });
              tx.objectStore("transactionLegs").put({
                id: `leg-profile-health-${suffix}`,
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
                revision: 1,
                transactionId,
                accountId: account.id,
                deltaMinor: 780_000
              });
              tx.objectStore("transactionSplits").put({
                id: `split-profile-health-${suffix}`,
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
                revision: 1,
                transactionId,
                categoryId: "cat-income",
                direction: "income",
                amountMinor: 780_000
              });
              tx.objectStore("balanceSnapshots").put({
                id: `bal-profile-health-${suffix}`,
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
                revision: 1,
                accountId: account.id,
                asOfDate: "2026-07-23",
                amountMinor: 120_000,
                source: "opening",
                note: "Derived from current balance minus salary deposit."
              });
              tx.objectStore("budgetCycles").put({
                id: cycleId,
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
                revision: 1,
                startedOn: "2026-07-24",
                status: "open",
                salaryTransactionId: transactionId,
                expectedNextSalaryFrom: "2026-08-24",
                expectedNextSalaryTo: "2026-08-26",
                protectedRateBasisPoints: 1_000,
                bufferMinimumMinor: 50_000,
                bufferEssentialRateBasisPoints: 1_000,
                actualMainSalaryMinor: 780_000
              });
              tx.objectStore("budgetAllocations").put({
                id: `alloc-profile-health-${suffix}`,
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
                revision: 1,
                budgetCycleId: cycleId,
                categoryId: "cat-living",
                baseAmountMinor: 120_000,
                note: "Profile Health browser fixture."
              });
            }
          };
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    openCycleCount
  );
  await page.reload();
}

export async function mockGoogleIdentity(page: Page) {
  await page.addInitScript(() => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config) => ({
            requestAccessToken: () => {
              window.__bluehourGoogleTokenRequests = (window.__bluehourGoogleTokenRequests ?? 0) + 1;
              config.callback({ access_token: "mock-token", expires_in: 3600 });
            }
          })
        }
      }
    };
  });
  await page.route("https://openidconnect.googleapis.com/v1/userinfo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sub: "google-subject",
        email: "person@example.com",
        name: "Example Person"
      })
    });
  });
}

export async function mockDriveAppDataVault(
  page: Page,
  options: {
    existingRemote?: boolean;
    remoteRevision?: number;
    onboardingStep?: string;
    lifecycle?: "setup" | "ready_for_salary" | "live";
    openCycleCount?: number;
  } = {}
) {
  const filesByName = new Map<string, string>();
  const namesById = new Map<string, string>();
  const contents = new Map<string, unknown | "">();
  const names = {
    manifest: "bluehour-manifest.json",
    slotA: "bluehour-slot-A.json",
    slotB: "bluehour-slot-B.json"
  };

  function register(name: string, id: string, content: unknown | "" = "") {
    filesByName.set(name, id);
    namesById.set(id, name);
    contents.set(id, content);
  }

  if (options.existingRemote) {
    const remoteRevision = options.remoteRevision ?? 14;
    const profileId = "0f9a12be-2c61-4f29-8e36-8f9272aa8f39";
    const exportedAt = "2026-06-22T09:42:00.000Z";
    register(names.manifest, "drive-manifest-file", {
      kind: "bluehour-drive-vault-manifest",
      schemaVersion: 2,
      remoteRevision,
      activeSlot: "A",
      profileId,
      committedAt: exportedAt,
      files: {
        manifestFileId: "drive-manifest-file",
        slotAFileId: "drive-slot-a-file",
        slotBFileId: "drive-slot-b-file"
      }
    });
    register(names.slotA, "drive-slot-a-file", {
      kind: "bluehour-drive-vault-slot",
      schemaVersion: 2,
      remoteRevision,
      profileId,
      exportedAt,
      appVersion: "1.0.0-rc.3",
      snapshot: {
        accounts: [
          {
            id: "remote-daily-current",
            name: "Remote current account",
            type: "bank",
            role: "spendable",
            trackingMode: "ledger",
            currency: "MYR",
            institutionLabel: "Remote Bank",
            reconcileWeekly: true,
            sortOrder: 1,
            createdAt: exportedAt,
            updatedAt: exportedAt,
            archivedAt: null,
            revision: 1
          }
        ],
        balanceSnapshots: Array.from({ length: options.openCycleCount ?? 0 }, (_, index) => remoteBalanceSnapshot(index, exportedAt)),
        transactions: Array.from({ length: options.openCycleCount ?? 0 }, (_, index) => remoteSalaryTransaction(index, exportedAt)),
        transactionLegs: Array.from({ length: options.openCycleCount ?? 0 }, (_, index) => remoteSalaryLeg(index, exportedAt)),
        transactionSplits: Array.from({ length: options.openCycleCount ?? 0 }, (_, index) => remoteSalarySplit(index, exportedAt)),
        budgetCycles: Array.from({ length: options.openCycleCount ?? 0 }, (_, index) => remoteBudgetCycle(index, exportedAt)),
        budgetAllocations: Array.from({ length: options.openCycleCount ?? 0 }, (_, index) => remoteBudgetAllocation(index, exportedAt)),
        settings: [
          {
            id: "settings-manifest",
            key: "profileManifest",
            valueJson: JSON.stringify({
              manifestVersion: 1,
              profileId,
              profileName: "Personal finances",
              currency: "MYR",
              lifecycle: options.lifecycle ?? "setup",
              onboardingStep: options.lifecycle === "live" ? undefined : options.onboardingStep ?? "budget",
              createdAt: exportedAt,
              updatedAt: exportedAt,
              createdByAppVersion: "1.0.0-rc.3"
            }),
            createdAt: exportedAt,
            updatedAt: exportedAt,
            archivedAt: null,
            revision: 1
          }
        ]
      }
    });
    register(names.slotB, "drive-slot-b-file", "");
  }

  await page.route(/https:\/\/www\.googleapis\.com\/drive\/v3\/files\?.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const name = /name = '([^']+)'/.exec(query)?.[1];
      const id = name ? filesByName.get(name) : undefined;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          files: id && name ? [{ id, name, modifiedTime: "2026-06-22T09:42:00.000Z" }] : []
        })
      });
      return;
    }

    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as { name?: string };
      const name = body.name ?? `unnamed-${filesByName.size + 1}`;
      const id =
        name === names.manifest
          ? "drive-manifest-file"
          : name === names.slotA
            ? "drive-slot-a-file"
            : name === names.slotB
              ? "drive-slot-b-file"
              : `drive-file-${filesByName.size + 1}`;
      register(name, id, "");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id, name }) });
      return;
    }

    await route.fallback();
  });

  await page.route(/https:\/\/www\.googleapis\.com\/drive\/v3\/files\/[^?]+\?alt=media/, async (route) => {
    const fileId = decodeURIComponent(/\/files\/([^?]+)/.exec(route.request().url())?.[1] ?? "");
    const content = contents.get(fileId) ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: typeof content === "string" ? content : JSON.stringify(content)
    });
  });

  await page.route(/https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/[^?]+.*/, async (route) => {
    const fileId = decodeURIComponent(/\/files\/([^?]+)/.exec(route.request().url())?.[1] ?? "");
    contents.set(fileId, JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: fileId }) });
  });

  await page.route(/https:\/\/www\.googleapis\.com\/drive\/v3\/files\/[^?]+$/, async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    const fileId = decodeURIComponent(/\/files\/([^?]+)/.exec(route.request().url())?.[1] ?? "");
    const name = namesById.get(fileId);
    if (name) {
      filesByName.delete(name);
    }
    namesById.delete(fileId);
    contents.delete(fileId);
    await route.fulfill({ status: 204, body: "" });
  });
}

function remoteSalaryTransaction(index: number, timestamp: string) {
  return {
    id: `remote-salary-${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    revision: 1,
    type: "income",
    status: "actual",
    occurredOn: "2026-07-24",
    description: "Main salary",
    merchantNormalized: "main salary",
    source: "manual"
  };
}

function remoteSalaryLeg(index: number, timestamp: string) {
  return {
    id: `remote-salary-leg-${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    revision: 1,
    transactionId: `remote-salary-${index}`,
    accountId: "remote-daily-current",
    deltaMinor: 780_000
  };
}

function remoteSalarySplit(index: number, timestamp: string) {
  return {
    id: `remote-salary-split-${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    revision: 1,
    transactionId: `remote-salary-${index}`,
    categoryId: "cat-income",
    direction: "income",
    amountMinor: 780_000
  };
}

function remoteBalanceSnapshot(index: number, timestamp: string) {
  return {
    id: `remote-opening-balance-${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    revision: 1,
    accountId: "remote-daily-current",
    asOfDate: "2026-07-23",
    amountMinor: 120_000,
    source: "opening",
    note: "Derived from current balance minus salary deposit."
  };
}

function remoteBudgetCycle(index: number, timestamp: string) {
  return {
    id: `remote-cycle-${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    revision: 1,
    startedOn: "2026-07-24",
    status: "open",
    salaryTransactionId: `remote-salary-${index}`,
    expectedNextSalaryFrom: "2026-08-24",
    expectedNextSalaryTo: "2026-08-26",
    protectedRateBasisPoints: 1_000,
    bufferMinimumMinor: 50_000,
    bufferEssentialRateBasisPoints: 1_000,
    actualMainSalaryMinor: 780_000
  };
}

function remoteBudgetAllocation(index: number, timestamp: string) {
  return {
    id: `remote-allocation-${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    revision: 1,
    budgetCycleId: `remote-cycle-${index}`,
    categoryId: "cat-living",
    baseAmountMinor: 120_000,
    note: "Remote Profile Health fixture."
  };
}
