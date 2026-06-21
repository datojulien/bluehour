import { describe, expect, it } from "vitest";
import { openDB } from "idb";
import { createRecordMeta } from "../../domain/records";
import type { Account } from "../../domain/types";
import {
  LEGACY_DB_NAME,
  PROFILE_DB_NAMES,
  loadDemoSnapshot,
  loadLiveSnapshot,
  putLocalRecords,
  replaceProfileSnapshot,
  resetDemoProfile,
  seedDemoIfNeeded
} from "./localDb";
import { createDemoSnapshot } from "../../test/fixtures/demoData";

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
});
