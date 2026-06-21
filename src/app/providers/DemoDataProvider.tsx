import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BluehourSnapshot, IsoDate } from "../../domain/types";
import {
  applyRemoteSyncResult,
  archiveLocalRecord,
  clearOutboxAndMarkSynced,
  loadDemoSnapshot,
  putLocalRecords,
  type LocalMutation,
  type MutableStoreName,
  type MutableRecord
} from "../../data/local-db/localDb";
import { createTransactionRecords, type TransactionDraft } from "../../domain/transactions/commands";
import type { ConflictRecord, SyncState } from "../../domain/types";
import { demoAsOfDate } from "../../test/fixtures/demoData";

interface DemoDataContextValue {
  snapshot: BluehourSnapshot | null;
  asOfDate: IsoDate;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  saveTransaction: (draft: TransactionDraft) => Promise<void>;
  saveRecord: (storeName: MutableStoreName, record: MutableRecord, label?: string) => Promise<void>;
  saveRecords: (mutations: LocalMutation[], label?: string) => Promise<void>;
  archiveRecord: (storeName: Parameters<typeof archiveLocalRecord>[0], recordId: string) => Promise<void>;
  applyRemoteSync: (args: {
    mutations: LocalMutation[];
    conflicts: ConflictRecord[];
    syncState: SyncState;
    clearOutbox: boolean;
  }) => Promise<void>;
  markSynced: (syncState: SyncState) => Promise<void>;
}

const DemoDataContext = createContext<DemoDataContextValue | undefined>(undefined);

export function DemoDataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BluehourSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await loadDemoSnapshot());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open local demo data");
    } finally {
      setLoading(false);
    }
  }

  async function saveRecords(mutations: LocalMutation[], label = "change") {
    await putLocalRecords(mutations, label);
    await reload();
  }

  async function saveRecord(storeName: MutableStoreName, record: MutableRecord, label = "change") {
    await saveRecords([{ storeName, record }], label);
  }

  async function saveTransaction(draft: TransactionDraft) {
    if (!snapshot) {
      throw new Error("Demo data has not loaded yet");
    }

    const result = createTransactionRecords(draft, snapshot);
    const mutations: LocalMutation[] = [
      { storeName: "transactions", record: result.transaction },
      ...result.legs.map((record) => ({ storeName: "transactionLegs" as const, record })),
      ...result.splits.map((record) => ({ storeName: "transactionSplits" as const, record }))
    ];

    if (result.updatedPlan) {
      mutations.push({ storeName: "planInstances", record: result.updatedPlan });
    }

    if (result.updatedRule) {
      mutations.push({ storeName: "categorisationRules", record: result.updatedRule });
    }

    await saveRecords(mutations, "transaction");
  }

  async function archiveRecord(storeName: Parameters<typeof archiveLocalRecord>[0], recordId: string) {
    await archiveLocalRecord(storeName, recordId);
    await reload();
  }

  async function applyRemoteSync(args: {
    mutations: LocalMutation[];
    conflicts: ConflictRecord[];
    syncState: SyncState;
    clearOutbox: boolean;
  }) {
    await applyRemoteSyncResult(args);
    await reload();
  }

  async function markSynced(syncState: SyncState) {
    await clearOutboxAndMarkSynced(syncState);
    await reload();
  }

  useEffect(() => {
    void reload();
  }, []);

  const value = useMemo(
    () => ({
      snapshot,
      asOfDate: demoAsOfDate,
      loading,
      error,
      reload,
      saveTransaction,
      saveRecord,
      saveRecords,
      archiveRecord,
      applyRemoteSync,
      markSynced
    }),
    [snapshot, loading, error]
  );

  return <DemoDataContext.Provider value={value}>{children}</DemoDataContext.Provider>;
}

export function useDemoData(): DemoDataContextValue {
  const value = useContext(DemoDataContext);
  if (!value) {
    throw new Error("useDemoData must be used inside DemoDataProvider");
  }

  return value;
}
