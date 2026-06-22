import type { LocalMutation, MutableStoreName } from "../local-db/localDb";
import { BLUEHOUR_SCHEMA_VERSION } from "../google/googleSheetsAdapter";
import { currentRemoteRevision, type RemoteSheetSnapshot } from "../google/sheetSerialization";
import { createRecordMeta } from "../../domain/records";
import type { BluehourSnapshot, ConflictRecord, OutboxOperation, SyncState } from "../../domain/types";
import { readProfileManifest } from "../../domain/profileManifest";

export const SYNCED_STORES = [
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
  "importRowAudits",
  "reconciliations",
  "reviewSessions",
  "settings"
] as const satisfies readonly MutableStoreName[];

export type SyncedStoreName = (typeof SYNCED_STORES)[number];

export interface GoogleSyncPlan {
  action: "push_local" | "no_op" | "apply_remote" | "conflict" | "read_only_recovery" | "cross_profile_blocked";
  remoteRevision: number;
  nextRemoteRevision: number;
  mutations: LocalMutation[];
  conflicts: ConflictRecord[];
  syncState: SyncState;
  clearOutbox: boolean;
}

export function planGoogleSheetSync(local: BluehourSnapshot, remote: RemoteSheetSnapshot): GoogleSyncPlan {
  const localRemoteRevision = currentRemoteRevision(local);
  const pendingOutbox = local.outboxOperations;
  const nextRemoteRevision = Math.max(localRemoteRevision, remote.remoteRevision) + 1;

  if ((remote.schemaVersion ?? 1) > BLUEHOUR_SCHEMA_VERSION) {
    return statePlan(
      "read_only_recovery",
      remote.remoteRevision,
      localRemoteRevision,
      [],
      [],
      false,
      `Google Sheet schema ${remote.schemaVersion} is newer than this Bluehour build supports.`
    );
  }

  const localManifest = safeProfileManifest(local);
  const remoteManifest = safeProfileManifest(remote.snapshot);
  if (localManifest && remoteManifest && localManifest.profileId !== remoteManifest.profileId) {
    return statePlan(
      "cross_profile_blocked",
      remote.remoteRevision,
      localRemoteRevision,
      [],
      [],
      false,
      "Remote profile ID differs from this local profile. Export a backup, replace explicitly, or cancel."
    );
  }

  if (remote.remoteRevision === 0) {
    return statePlan("push_local", remote.remoteRevision, nextRemoteRevision, [], [], true, "Remote Sheet is empty; local data should be pushed.");
  }

  if (remote.remoteRevision < localRemoteRevision) {
    return statePlan("push_local", remote.remoteRevision, nextRemoteRevision, [], [], true, "Local revision is ahead of the Sheet.");
  }

  if (remote.remoteRevision === localRemoteRevision) {
    if (pendingOutbox.length > 0) {
      return statePlan("push_local", remote.remoteRevision, nextRemoteRevision, [], [], true, "Local outbox is ready to push.");
    }

    return statePlan("no_op", remote.remoteRevision, localRemoteRevision, [], [], false, "Local data and Google Sheet are in sync.");
  }

  const localChangeMap = outboxChangeMap(pendingOutbox);
  const mutations: LocalMutation[] = [];
  const conflicts: ConflictRecord[] = [];

  for (const storeName of SYNCED_STORES) {
    const localRecords = recordsForStore(local, storeName);
    const remoteRecords = recordsForStore(remote.snapshot, storeName);
    const localById = new Map(localRecords.map((record) => [recordKey(record), record]));

    for (const remoteRecord of remoteRecords) {
      const key = recordKey(remoteRecord);
      const localRecord = localById.get(key);
      const changedLocally = localChangeMap.get(storeName)?.has(key) ?? false;

      if (changedLocally && localRecord && !sameRecord(localRecord, remoteRecord)) {
        conflicts.push(createConflict(storeName, key, localRecord, remoteRecord));
        continue;
      }

      if (!localRecord || !sameRecord(localRecord, remoteRecord)) {
        mutations.push({
          storeName,
          record: remoteRecord as never,
          outbox: false
        });
      }
    }
  }

  if (conflicts.length > 0) {
    return statePlan(
      "conflict",
      remote.remoteRevision,
      nextRemoteRevision,
      mutations,
      conflicts,
      false,
      `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} require review.`
    );
  }

  return statePlan(
    "apply_remote",
    remote.remoteRevision,
    remote.remoteRevision,
    mutations,
    [],
    pendingOutbox.length === 0,
    pendingOutbox.length > 0
      ? "Remote changes applied locally. Local changes are still waiting for an explicit sync."
      : mutations.length > 0
        ? "Remote changes applied locally."
        : "Remote revision recorded locally."
  );
}

function statePlan(
  action: GoogleSyncPlan["action"],
  remoteRevision: number,
  nextRemoteRevision: number,
  mutations: LocalMutation[],
  conflicts: ConflictRecord[],
  clearOutbox: boolean,
  message: string
): GoogleSyncPlan {
  return {
    action,
    remoteRevision,
    nextRemoteRevision,
    mutations,
    conflicts,
    clearOutbox,
    syncState: {
      key: "google",
      status:
        action === "read_only_recovery"
          ? "read_only_recovery"
          : action === "cross_profile_blocked"
            ? "failed"
          : action === "conflict"
            ? "conflict"
            : action === "no_op"
              ? "synced"
              : action === "push_local"
                ? "waiting_to_sync"
                : clearOutbox
                  ? "synced"
                  : "waiting_to_sync",
      remoteRevision: action === "push_local" ? nextRemoteRevision : remoteRevision,
      lastSyncedAt: action === "conflict" ? undefined : new Date().toISOString(),
      message
    }
  };
}

function safeProfileManifest(snapshot: Partial<BluehourSnapshot>) {
  try {
    return snapshot.settings ? readProfileManifest(snapshot.settings) : null;
  } catch {
    return null;
  }
}

function recordsForStore(snapshot: Partial<BluehourSnapshot>, storeName: SyncedStoreName): Array<Record<string, unknown>> {
  return ((snapshot[storeName] ?? []) as unknown as Array<Record<string, unknown>>).filter(Boolean);
}

function recordKey(record: Record<string, unknown>): string {
  const key = record.id ?? record.key;
  if (typeof key !== "string") {
    throw new Error("Synced records must have an id or key");
  }

  return key;
}

function outboxChangeMap(outbox: readonly OutboxOperation[]): Map<SyncedStoreName, Set<string>> {
  const map = new Map<SyncedStoreName, Set<string>>();
  outbox.forEach((operation) => {
    if (!isSyncedStore(operation.tableName)) {
      return;
    }

    const set = map.get(operation.tableName) ?? new Set<string>();
    set.add(operation.recordId);
    map.set(operation.tableName, set);
  });
  return map;
}

function createConflict(storeName: SyncedStoreName, recordId: string, localRecord: object, remoteRecord: object): ConflictRecord {
  return {
    ...createRecordMeta("conflict"),
    tableName: storeName,
    recordId,
    localJson: JSON.stringify(localRecord),
    remoteJson: JSON.stringify(remoteRecord),
    status: "open"
  };
}

function sameRecord(left: object, right: object): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function isSyncedStore(value: string): value is SyncedStoreName {
  return (SYNCED_STORES as readonly string[]).includes(value);
}
