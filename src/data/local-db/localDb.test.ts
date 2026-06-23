import { describe, expect, it } from "vitest";
import { openDB } from "idb";
import { createRecordMeta } from "../../domain/records";
import type { Account, Category } from "../../domain/types";
import {
  LEGACY_DB_NAME,
  PROFILE_DB_NAMES,
  INDEXED_DB_SCHEMA_VERSION,
  loadDemoSnapshot,
  loadLiveSnapshot,
  putLocalRecords,
  replaceProfileSnapshot,
  resetDemoProfile,
  resetLiveProfile,
  seedDemoIfNeeded
} from "./localDb";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import { readProfileManifest } from "../../domain/profileManifest";

describe("local IndexedDB repository", () => {
  async function deleteDatabase(name: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }

  it("seeds fictional demo records idempotently", async () => {
    await deleteDatabase(PROFILE_DB_NAMES.demo);
    await seedDemoIfNeeded();
    await seedDemoIfNeeded();

    const snapshot = await loadDemoSnapshot();
    expect(snapshot.accounts.length).toBe(5);
    expect(snapshot.transactions.length).toBe(13);
    expect(snapshot.accounts.every((account) => account.currency === "MYR")).toBe(true);
  });

  it("opens a live profile without fictional financial records", async () => {
    await deleteDatabase(PROFILE_DB_NAMES.live);
    const snapshot = await loadLiveSnapshot();

    expect(snapshot.accounts).toHaveLength(0);
    expect(snapshot.transactions).toHaveLength(0);
    expect(snapshot.planInstances).toHaveLength(0);
    expect(snapshot.subscriptions).toHaveLength(0);
    expect(snapshot.settings.some((setting) => setting.key === "preferences")).toBe(true);
    expect(readProfileManifest(snapshot.settings)?.lifecycle).toBe("setup");
    expect(snapshot.syncState[0]?.status).toBe("saved_locally");
  });

  it("keeps demo reset isolated from live data", async () => {
    await deleteDatabase(PROFILE_DB_NAMES.demo);
    await deleteDatabase(PROFILE_DB_NAMES.live);
    await loadLiveSnapshot();

    const account: Account = {
      ...createRecordMeta("acc"),
      name: "Live current account",
      type: "bank",
      role: "spendable",
      trackingMode: "ledger",
      currency: "MYR",
      reconcileWeekly: true,
      sortOrder: 1
    };
    await putLocalRecords("live", [{ storeName: "accounts", record: account }], "test account");
    await resetDemoProfile();

    const live = await loadLiveSnapshot();
    const demo = await loadDemoSnapshot();
    expect(live.accounts.map((record) => record.name)).toEqual(["Live current account"]);
    expect(demo.accounts.map((record) => record.name)).not.toContain("Live current account");
  });

  it("preserves Drive sync metadata when queuing a local live change", async () => {
    await deleteDatabase(PROFILE_DB_NAMES.live);
    const snapshot = await loadLiveSnapshot();
    await replaceProfileSnapshot("live", {
      ...snapshot,
      syncState: [
        {
          key: "google",
          provider: "drive_appdata",
          status: "synced",
          driveManifestFileId: "manifest-file",
          driveSlotAFileId: "slot-a-file",
          driveSlotBFileId: "slot-b-file",
          googleSubject: "google-subject",
          googleEmail: "person@example.com",
          profileId: "profile-1",
          remoteRevision: 4,
          lastSyncedAt: "2026-06-23T00:00:00.000Z",
          message: "Synced before local change."
        }
      ]
    });

    const account: Account = {
      ...createRecordMeta("acc-drive-preserve"),
      name: "Live current account",
      type: "bank",
      role: "spendable",
      trackingMode: "ledger",
      currency: "MYR",
      reconcileWeekly: true,
      sortOrder: 1
    };
    await putLocalRecords("live", [{ storeName: "accounts", record: account }], "test account");

    const live = await loadLiveSnapshot();
    expect(live.syncState[0]).toMatchObject({
      provider: "drive_appdata",
      status: "waiting_to_sync",
      driveManifestFileId: "manifest-file",
      driveSlotAFileId: "slot-a-file",
      driveSlotBFileId: "slot-b-file",
      googleSubject: "google-subject",
      googleEmail: "person@example.com",
      profileId: "profile-1",
      remoteRevision: 4
    });
  });

  it("resets the live profile to a blank local setup without preserving Google connection data", async () => {
    await deleteDatabase(PROFILE_DB_NAMES.live);
    const snapshot = await loadLiveSnapshot();
    const account: Account = {
      ...createRecordMeta("acc-reset"),
      name: "Reset current account",
      type: "bank",
      role: "spendable",
      trackingMode: "ledger",
      currency: "MYR",
      reconcileWeekly: true,
      sortOrder: 1
    };
    await replaceProfileSnapshot("live", {
      ...snapshot,
      accounts: [account],
      syncState: [
        {
          key: "google",
          provider: "drive_appdata",
          status: "synced",
          driveManifestFileId: "manifest-file",
          driveSlotAFileId: "slot-a-file",
          driveSlotBFileId: "slot-b-file",
          googleSubject: "google-subject",
          googleEmail: "person@example.com",
          profileId: "profile-1",
          remoteRevision: 8,
          lastSyncedAt: "2026-06-23T00:00:00.000Z"
        }
      ]
    });

    await resetLiveProfile();

    const live = await loadLiveSnapshot();
    expect(live.accounts).toEqual([]);
    expect(live.transactions).toEqual([]);
    expect(live.budgetCycles).toEqual([]);
    expect(readProfileManifest(live.settings)?.lifecycle).toBe("setup");
    expect(live.settings.find((setting) => setting.key === "googleConnection" && !setting.archivedAt)).toBeUndefined();
    expect(live.syncState[0]).toMatchObject({
      key: "google",
      status: "saved_locally"
    });
  });

  it("does not clear or migrate the legacy bluehour-local database", async () => {
    await deleteDatabase(LEGACY_DB_NAME);
    const legacy = await openDB(LEGACY_DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore("sentinel");
      }
    });
    await legacy.put("sentinel", "keep-me", "marker");
    legacy.close();

    await resetDemoProfile();
    await loadLiveSnapshot();

    const reopened = await openDB(LEGACY_DB_NAME, 1);
    expect(await reopened.get("sentinel", "marker")).toBe("keep-me");
    reopened.close();
  });

  it("repairs existing live starter categories and queues them for remote sync", async () => {
    await deleteDatabase(PROFILE_DB_NAMES.live);
    const db = await openDB(PROFILE_DB_NAMES.live, INDEXED_DB_SCHEMA_VERSION, {
      upgrade(upgradeDb) {
        [
          "accounts",
          "balanceSnapshots",
          "transactions",
          "transactionLegs",
          "transactionSplits",
          "categories",
          "budgetCycles",
          "budgetAllocations",
          "budgetTransfers",
          "recurringRules",
          "planInstances",
          "subscriptions",
          "extraIncomeAllocations",
          "categorisationRules",
          "importProfiles",
          "importBatches",
          "importRowAudits",
          "reconciliations",
          "reviewSessions",
          "settings",
          "outboxOperations",
          "conflicts"
        ].forEach((store) => upgradeDb.createObjectStore(store, { keyPath: "id" }));
        upgradeDb.createObjectStore("syncState", { keyPath: "key" });
        upgradeDb.createObjectStore("meta", { keyPath: "key" });
      }
    });
    const dining: Category = {
      ...createRecordMeta("cat-dining"),
      id: "cat-dining",
      name: "Meals Out",
      group: "discretionary",
      nature: "discretionary",
      reservationMode: "none",
      sortOrder: 10,
      active: true
    };
    await db.put("categories", dining);
    await db.put("syncState", { key: "google", status: "synced", provider: "drive_appdata", remoteRevision: 2 });
    db.close();

    const snapshot = await loadLiveSnapshot();

    expect(snapshot.categories.find((category) => category.id === "cat-dining")).toMatchObject({
      name: "Meals Out",
      reservationMode: "envelope"
    });
    expect(snapshot.outboxOperations.some((operation) => operation.tableName === "categories" && operation.recordId === "cat-dining")).toBe(true);
    expect(snapshot.syncState[0]?.status).toBe("waiting_to_sync");
  });

  it("validates backup replacement before clearing the current profile", async () => {
    await deleteDatabase(PROFILE_DB_NAMES.live);
    const account: Account = {
      ...createRecordMeta("acc"),
      name: "Keep me",
      type: "bank",
      role: "spendable",
      trackingMode: "ledger",
      currency: "MYR",
      reconcileWeekly: true,
      sortOrder: 1
    };
    await putLocalRecords("live", [{ storeName: "accounts", record: account }], "test account");

    const invalid = {
      ...createDemoSnapshot(),
      accounts: [{ ...createDemoSnapshot().accounts[0], currency: "USD" as "MYR" }]
    };

    await expect(replaceProfileSnapshot("live", invalid)).rejects.toThrow();
    const live = await loadLiveSnapshot();
    expect(live.accounts.map((record) => record.name)).toEqual(["Keep me"]);
  });

  it("upgrades a previous profile database by adding extra income storage without clearing records", async () => {
    await deleteDatabase(PROFILE_DB_NAMES.live);
    const oldStores = [
      "accounts",
      "balanceSnapshots",
      "transactions",
      "transactionLegs",
      "transactionSplits",
      "categories",
      "budgetCycles",
      "budgetAllocations",
      "budgetTransfers",
      "recurringRules",
      "planInstances",
      "subscriptions",
      "categorisationRules",
      "importProfiles",
      "importBatches",
      "reconciliations",
      "reviewSessions",
      "settings",
      "outboxOperations",
      "conflicts",
      "syncState",
      "meta"
    ];
    const oldDb = await openDB(PROFILE_DB_NAMES.live, INDEXED_DB_SCHEMA_VERSION - 1, {
      upgrade(db) {
        oldStores.forEach((store) => {
          db.createObjectStore(store, { keyPath: store === "syncState" || store === "meta" ? "key" : "id" });
        });
      }
    });
    const account: Account = {
      ...createRecordMeta("acc"),
      name: "Preserved account",
      type: "bank",
      role: "spendable",
      trackingMode: "ledger",
      currency: "MYR",
      reconcileWeekly: true,
      sortOrder: 1
    };
    await oldDb.put("accounts", account);
    oldDb.close();

    const snapshot = await loadLiveSnapshot();

    expect(snapshot.accounts.map((record) => record.name)).toContain("Preserved account");
    expect(snapshot.importRowAudits).toEqual([]);
    expect(snapshot.extraIncomeAllocations).toEqual([]);
  });
});
