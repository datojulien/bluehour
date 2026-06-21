import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  Account,
  BalanceSnapshot,
  BluehourSnapshot,
  BudgetAllocation,
  BudgetCycle,
  BudgetTransfer,
  CategorisationRule,
  Category,
  ConflictRecord,
  AppSettings,
  ImportBatch,
  ImportProfile,
  OutboxOperation,
  PlanInstance,
  Reconciliation,
  ReviewSession,
  RecurringRule,
  SyncState,
  Subscription,
  Transaction,
  TransactionLeg,
  TransactionSplit
} from "../../domain/types";
import { createDemoSnapshot } from "../../test/fixtures/demoData";
import {
  accountSchema,
  balanceSnapshotSchema,
  budgetAllocationSchema,
  budgetCycleSchema,
  budgetTransferSchema,
  categorisationRuleSchema,
  categorySchema,
  conflictRecordSchema,
  appSettingsSchema,
  importBatchSchema,
  importProfileSchema,
  outboxOperationSchema,
  planInstanceSchema,
  reconciliationSchema,
  reviewSessionSchema,
  recurringRuleSchema,
  syncStateSchema,
  subscriptionSchema,
  transactionLegSchema,
  transactionSchema,
  transactionSplitSchema
} from "./validators";

export type ProfileId = "demo" | "live";

export const LEGACY_DB_NAME = "bluehour-local";
export const PROFILE_DB_NAMES: Record<ProfileId, string> = {
  demo: "bluehour-profile-demo",
  live: "bluehour-profile-live"
};

const DB_VERSION = 3;
export const INDEXED_DB_SCHEMA_VERSION = DB_VERSION;
export const DEMO_FIXTURE_VERSION = "v1-local-demo-v4";

interface LocalMeta {
  key: string;
  value: string;
}

interface BluehourDB extends DBSchema {
  accounts: { key: string; value: Account };
  balanceSnapshots: { key: string; value: BalanceSnapshot };
  transactions: { key: string; value: Transaction };
  transactionLegs: { key: string; value: TransactionLeg };
  transactionSplits: { key: string; value: TransactionSplit };
  categories: { key: string; value: Category };
  budgetCycles: { key: string; value: BudgetCycle };
  budgetAllocations: { key: string; value: BudgetAllocation };
  budgetTransfers: { key: string; value: BudgetTransfer };
  recurringRules: { key: string; value: RecurringRule };
  planInstances: { key: string; value: PlanInstance };
  subscriptions: { key: string; value: Subscription };
  categorisationRules: { key: string; value: CategorisationRule };
  importProfiles: { key: string; value: ImportProfile };
  importBatches: { key: string; value: ImportBatch };
  reconciliations: { key: string; value: Reconciliation };
  reviewSessions: { key: string; value: ReviewSession };
  settings: { key: string; value: AppSettings };
  outboxOperations: { key: string; value: OutboxOperation };
  conflicts: { key: string; value: ConflictRecord };
  syncState: { key: string; value: SyncState };
  meta: { key: string; value: LocalMeta };
}

type DomainStoreName =
  | "accounts"
  | "balanceSnapshots"
  | "transactions"
  | "transactionLegs"
  | "transactionSplits"
  | "categories"
  | "budgetCycles"
  | "budgetAllocations"
  | "budgetTransfers"
  | "recurringRules"
  | "planInstances"
  | "subscriptions"
  | "categorisationRules"
  | "importProfiles"
  | "importBatches"
  | "reconciliations"
  | "reviewSessions";
type SupportStoreName = "settings" | "outboxOperations" | "conflicts" | "syncState";

const DOMAIN_STORES = [
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
  "reviewSessions"
] as const satisfies readonly DomainStoreName[];

const SUPPORT_STORES = ["settings", "outboxOperations", "conflicts", "syncState"] as const satisfies readonly SupportStoreName[];
const MUTABLE_STORES = [...DOMAIN_STORES, ...SUPPORT_STORES] as const;
const SEED_STORES = [...MUTABLE_STORES, "meta"] as const;

export async function openBluehourDb(profileId: ProfileId = "demo"): Promise<IDBPDatabase<BluehourDB>> {
  return openDB<BluehourDB>(PROFILE_DB_NAMES[profileId], DB_VERSION, {
    upgrade(db) {
      for (const store of [...DOMAIN_STORES, "settings", "outboxOperations", "conflicts"] as const) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      }

      if (db.objectStoreNames.contains("syncState")) {
        db.deleteObjectStore("syncState");
      }
      db.createObjectStore("syncState", { keyPath: "key" });

      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    }
  });
}

export async function legacyDatabaseExists(): Promise<boolean> {
  const databaseApi = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };

  if (!databaseApi.databases) {
    return false;
  }

  const databases = await databaseApi.databases();
  return databases.some((database) => database.name === LEGACY_DB_NAME);
}

export async function seedDemoIfNeeded(): Promise<void> {
  const db = await openBluehourDb("demo");
  const currentSeed = await db.get("meta", "demoSeedVersion");
  const existingAccounts = await db.count("accounts");
  const existingTransactions = await db.count("transactions");

  if (existingAccounts > 0 || existingTransactions > 0) {
    if (currentSeed?.value !== DEMO_FIXTURE_VERSION) {
      await db.put("meta", { key: "demoSeedVersion", value: DEMO_FIXTURE_VERSION });
    }
    db.close();
    return;
  }

  const snapshot = createDemoSnapshot();
  validateSnapshot(snapshot);

  const tx = db.transaction(SEED_STORES, "readwrite");
  await putAll(tx.objectStore("accounts"), snapshot.accounts);
  await putAll(tx.objectStore("balanceSnapshots"), snapshot.balanceSnapshots);
  await putAll(tx.objectStore("transactions"), snapshot.transactions);
  await putAll(tx.objectStore("transactionLegs"), snapshot.transactionLegs);
  await putAll(tx.objectStore("transactionSplits"), snapshot.transactionSplits);
  await putAll(tx.objectStore("categories"), snapshot.categories);
  await putAll(tx.objectStore("budgetCycles"), snapshot.budgetCycles);
  await putAll(tx.objectStore("budgetAllocations"), snapshot.budgetAllocations);
  await putAll(tx.objectStore("budgetTransfers"), snapshot.budgetTransfers);
  await putAll(tx.objectStore("recurringRules"), snapshot.recurringRules);
  await putAll(tx.objectStore("planInstances"), snapshot.planInstances);
  await putAll(tx.objectStore("subscriptions"), snapshot.subscriptions);
  await putAll(tx.objectStore("categorisationRules"), snapshot.categorisationRules);
  await putAll(tx.objectStore("importProfiles"), snapshot.importProfiles);
  await putAll(tx.objectStore("importBatches"), snapshot.importBatches);
  await putAll(tx.objectStore("reconciliations"), snapshot.reconciliations);
  await putAll(tx.objectStore("reviewSessions"), snapshot.reviewSessions);
  await putAll(tx.objectStore("settings"), snapshot.settings);
  await putAll(tx.objectStore("outboxOperations"), snapshot.outboxOperations);
  await putAll(tx.objectStore("conflicts"), snapshot.conflicts);
  await putAll(tx.objectStore("syncState"), snapshot.syncState);
  await tx.objectStore("meta").put({ key: "demoSeedVersion", value: DEMO_FIXTURE_VERSION });
  await tx.objectStore("meta").put({ key: "activeProfile", value: "demo" });
  await tx.done;
  db.close();
}

export async function resetDemoProfile(): Promise<void> {
  const db = await openBluehourDb("demo");
  const snapshot = createDemoSnapshot();
  validateSnapshot(snapshot);

  const tx = db.transaction(SEED_STORES, "readwrite");
  for (const store of MUTABLE_STORES) {
    await tx.objectStore(store).clear();
  }
  await tx.objectStore("meta").clear();

  await putAll(tx.objectStore("accounts"), snapshot.accounts);
  await putAll(tx.objectStore("balanceSnapshots"), snapshot.balanceSnapshots);
  await putAll(tx.objectStore("transactions"), snapshot.transactions);
  await putAll(tx.objectStore("transactionLegs"), snapshot.transactionLegs);
  await putAll(tx.objectStore("transactionSplits"), snapshot.transactionSplits);
  await putAll(tx.objectStore("categories"), snapshot.categories);
  await putAll(tx.objectStore("budgetCycles"), snapshot.budgetCycles);
  await putAll(tx.objectStore("budgetAllocations"), snapshot.budgetAllocations);
  await putAll(tx.objectStore("budgetTransfers"), snapshot.budgetTransfers);
  await putAll(tx.objectStore("recurringRules"), snapshot.recurringRules);
  await putAll(tx.objectStore("planInstances"), snapshot.planInstances);
  await putAll(tx.objectStore("subscriptions"), snapshot.subscriptions);
  await putAll(tx.objectStore("categorisationRules"), snapshot.categorisationRules);
  await putAll(tx.objectStore("importProfiles"), snapshot.importProfiles);
  await putAll(tx.objectStore("importBatches"), snapshot.importBatches);
  await putAll(tx.objectStore("reconciliations"), snapshot.reconciliations);
  await putAll(tx.objectStore("reviewSessions"), snapshot.reviewSessions);
  await putAll(tx.objectStore("settings"), snapshot.settings);
  await putAll(tx.objectStore("outboxOperations"), snapshot.outboxOperations);
  await putAll(tx.objectStore("conflicts"), snapshot.conflicts);
  await putAll(tx.objectStore("syncState"), snapshot.syncState);
  await tx.objectStore("meta").put({ key: "demoSeedVersion", value: DEMO_FIXTURE_VERSION });
  await tx.objectStore("meta").put({ key: "activeProfile", value: "demo" });
  await tx.done;
  db.close();
}

export async function initializeLiveProfile(): Promise<void> {
  const db = await openBluehourDb("live");
  const existingSyncState = await db.get("syncState", "google");
  const existingPreferences = (await db.getAll("settings")).find((setting) => setting.key === "preferences");

  if (existingSyncState && existingPreferences) {
    db.close();
    return;
  }

  const tx = db.transaction(["settings", "syncState", "meta"], "readwrite");
  if (!existingPreferences) {
    const now = new Date().toISOString();
    await tx.objectStore("settings").put({
      id: "settings-preferences-live",
      key: "preferences",
      valueJson: JSON.stringify({
        currency: "MYR",
        locale: "en-MY",
        dateDisplay: "DD/MM/YYYY",
        amountDisplay: "RM1,234.50",
        salaryWindowStartDay: 24,
        salaryWindowEndDay: 26,
        minimumProtectedRateBasisPoints: 1_000,
        bufferMinimumMinor: 50_000,
        bufferEssentialRateBasisPoints: 1_000,
        weeklyReconciliationDefault: true
      }),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      revision: 1
    } satisfies AppSettings);
  }

  if (!existingSyncState) {
    await tx.objectStore("syncState").put({
      key: "google",
      status: "saved_locally",
      message: "Live profile is saved locally. Google backup is not configured."
    } satisfies SyncState);
  }

  await tx.objectStore("meta").put({ key: "activeProfile", value: "live" });
  await tx.done;
  db.close();
}

export async function loadProfileSnapshot(profileId: ProfileId): Promise<BluehourSnapshot> {
  if (profileId === "demo") {
    await seedDemoIfNeeded();
  } else {
    await initializeLiveProfile();
  }

  const db = await openBluehourDb(profileId);
  const snapshot: BluehourSnapshot = {
    accounts: await db.getAll("accounts"),
    balanceSnapshots: await db.getAll("balanceSnapshots"),
    transactions: await db.getAll("transactions"),
    transactionLegs: await db.getAll("transactionLegs"),
    transactionSplits: await db.getAll("transactionSplits"),
    categories: await db.getAll("categories"),
    budgetCycles: await db.getAll("budgetCycles"),
    budgetAllocations: await db.getAll("budgetAllocations"),
    budgetTransfers: await db.getAll("budgetTransfers"),
    recurringRules: await db.getAll("recurringRules"),
    planInstances: await db.getAll("planInstances"),
    subscriptions: await db.getAll("subscriptions"),
    categorisationRules: await db.getAll("categorisationRules"),
    importProfiles: await db.getAll("importProfiles"),
    importBatches: await db.getAll("importBatches"),
    reconciliations: await db.getAll("reconciliations"),
    reviewSessions: await db.getAll("reviewSessions")
    ,
    settings: await db.getAll("settings"),
    outboxOperations: await db.getAll("outboxOperations"),
    conflicts: await db.getAll("conflicts"),
    syncState: await db.getAll("syncState")
  };
  validateSnapshot(snapshot);
  db.close();
  return snapshot;
}

export async function loadDemoSnapshot(): Promise<BluehourSnapshot> {
  return loadProfileSnapshot("demo");
}

export async function loadLiveSnapshot(): Promise<BluehourSnapshot> {
  return loadProfileSnapshot("live");
}

function validateSnapshot(snapshot: BluehourSnapshot): void {
  snapshot.accounts.forEach((record) => accountSchema.parse(record));
  snapshot.balanceSnapshots.forEach((record) => balanceSnapshotSchema.parse(record));
  snapshot.transactions.forEach((record) => transactionSchema.parse(record));
  snapshot.transactionLegs.forEach((record) => transactionLegSchema.parse(record));
  snapshot.transactionSplits.forEach((record) => transactionSplitSchema.parse(record));
  snapshot.categories.forEach((record) => categorySchema.parse(record));
  snapshot.budgetCycles.forEach((record) => budgetCycleSchema.parse(record));
  snapshot.budgetAllocations.forEach((record) => budgetAllocationSchema.parse(record));
  snapshot.budgetTransfers.forEach((record) => budgetTransferSchema.parse(record));
  snapshot.recurringRules.forEach((record) => recurringRuleSchema.parse(record));
  snapshot.planInstances.forEach((record) => planInstanceSchema.parse(record));
  snapshot.subscriptions.forEach((record) => subscriptionSchema.parse(record));
  snapshot.categorisationRules.forEach((record) => categorisationRuleSchema.parse(record));
  snapshot.importProfiles.forEach((record) => importProfileSchema.parse(record));
  snapshot.importBatches.forEach((record) => importBatchSchema.parse(record));
  snapshot.reconciliations.forEach((record) => reconciliationSchema.parse(record));
  snapshot.reviewSessions.forEach((record) => reviewSessionSchema.parse(record));
  snapshot.settings.forEach((record) => appSettingsSchema.parse(record));
  snapshot.outboxOperations.forEach((record) => outboxOperationSchema.parse(record));
  snapshot.conflicts.forEach((record) => conflictRecordSchema.parse(record));
  snapshot.syncState.forEach((record) => syncStateSchema.parse(record));
}

async function putAll<T>(store: { put(value: T): Promise<IDBValidKey> }, values: readonly T[]): Promise<void> {
  await Promise.all(values.map((value) => store.put(value)));
}

export type MutableStoreName = (typeof MUTABLE_STORES)[number];
export type MutableRecord = BluehourDB[MutableStoreName]["value"];

export interface LocalMutation {
  storeName: MutableStoreName;
  record: MutableRecord;
  outbox?: boolean;
}

export async function putLocalRecords(profileId: ProfileId, mutations: readonly LocalMutation[], outboxLabel = "manual"): Promise<void> {
  if (mutations.length === 0) {
    return;
  }

  const db = await openBluehourDb(profileId);
  const tx = db.transaction([...MUTABLE_STORES], "readwrite");
  const now = new Date().toISOString();
  const shouldQueueOutbox = profileId === "live";

  for (const mutation of mutations) {
    await tx.objectStore(mutation.storeName).put(mutation.record as never);
    if (shouldQueueOutbox && (mutation.outbox ?? mutation.storeName !== "outboxOperations")) {
      const record = mutation.record as { id?: string; key?: string };
      const recordId = record.id ?? record.key ?? crypto.randomUUID();
      const operation: OutboxOperation = {
        id: `outbox-${crypto.randomUUID()}`,
        tableName: mutation.storeName,
        recordId,
        operation: "put",
        payloadJson: JSON.stringify(mutation.record),
        createdAt: now,
        attempts: 0
      };
      await tx.objectStore("outboxOperations").put(operation);
    }
  }

  await tx.objectStore("syncState").put({
    key: "google",
    status: profileId === "demo" ? "demo" : "waiting_to_sync",
    message:
      profileId === "demo"
        ? `${outboxLabel} saved in the fictional demonstration profile. Google sync is disabled.`
        : `${outboxLabel} saved locally and waiting to sync.`
  });
  await tx.done;
  db.close();
}

export async function archiveLocalRecord(profileId: ProfileId, storeName: DomainStoreName, recordId: string): Promise<void> {
  const db = await openBluehourDb(profileId);
  const tx = db.transaction([...MUTABLE_STORES], "readwrite");
  const store = tx.objectStore(storeName);
  const current = (await store.get(recordId)) as ({ id: string; archivedAt?: string | null; updatedAt?: string; revision?: number } | undefined);
  if (!current) {
    throw new Error(`Record ${recordId} was not found in ${storeName}`);
  }

  const now = new Date().toISOString();
  const archived = {
    ...current,
    archivedAt: now,
    updatedAt: now,
    revision: (current.revision ?? 0) + 1
  };
  await store.put(archived as never);
  if (profileId === "live") {
    await tx.objectStore("outboxOperations").put({
      id: `outbox-${crypto.randomUUID()}`,
      tableName: storeName,
      recordId,
      operation: "archive",
      payloadJson: JSON.stringify(archived),
      createdAt: now,
      attempts: 0
    } satisfies OutboxOperation);
  }
  await tx.objectStore("syncState").put({
    key: "google",
    status: profileId === "demo" ? "demo" : "waiting_to_sync",
    message: profileId === "demo" ? "Demo archive saved locally. Google sync is disabled." : "Archive saved locally and waiting to sync."
  });
  await tx.done;
  db.close();
}

export async function applyRemoteSyncResult(
  profileId: ProfileId,
  {
    mutations,
    conflicts,
    syncState,
    clearOutbox
  }: {
  mutations: readonly LocalMutation[];
  conflicts: readonly ConflictRecord[];
  syncState: SyncState;
  clearOutbox: boolean;
  }
): Promise<void> {
  const db = await openBluehourDb(profileId);
  const tx = db.transaction([...MUTABLE_STORES], "readwrite");

  for (const mutation of mutations) {
    await tx.objectStore(mutation.storeName).put(mutation.record as never);
  }

  for (const conflict of conflicts) {
    await tx.objectStore("conflicts").put(conflict);
  }

  if (clearOutbox) {
    await tx.objectStore("outboxOperations").clear();
  }

  await tx.objectStore("syncState").put(syncState);
  await tx.done;
  db.close();
}

export async function clearOutboxAndMarkSynced(profileId: ProfileId, syncState: SyncState): Promise<void> {
  const db = await openBluehourDb(profileId);
  const tx = db.transaction(["outboxOperations", "syncState"], "readwrite");
  await tx.objectStore("outboxOperations").clear();
  await tx.objectStore("syncState").put(syncState);
  await tx.done;
  db.close();
}
