import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { browserLocalClock, demoClock, type BluehourClock } from "../../domain/clock";
import type { BluehourSnapshot, ConflictRecord, IsoDate, SyncState } from "../../domain/types";
import {
  applyRemoteSyncResult,
  archiveLocalRecord,
  clearOutboxAndMarkSynced,
  initializeLiveProfile,
  loadProfileSnapshot,
  putLocalRecords,
  resetDemoProfile,
  type LocalMutation,
  type MutableRecord,
  type MutableStoreName,
  type ProfileId
} from "../../data/local-db/localDb";
import { loadShellState, saveShellState, type ApplicationState, type OnboardingStep, type ShellState } from "../../data/local-db/shellDb";
import { createTransactionRecords, type TransactionDraft } from "../../domain/transactions/commands";

interface BluehourDataContextValue {
  snapshot: BluehourSnapshot | null;
  shellState: ShellState | null;
  applicationState: ApplicationState;
  activeProfile: ProfileId | null;
  profileLabel: string;
  isDemo: boolean;
  canUseGoogleSync: boolean;
  asOfDate: IsoDate;
  clock: BluehourClock;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  exploreDemo: () => Promise<void>;
  resetDemo: () => Promise<void>;
  returnToWelcome: () => Promise<void>;
  startLiveSetup: () => Promise<void>;
  setOnboardingStep: (step: OnboardingStep, state?: ApplicationState) => Promise<void>;
  enterLiveMode: () => Promise<void>;
  saveTransaction: (draft: TransactionDraft) => Promise<void>;
  saveRecord: (storeName: MutableStoreName, record: MutableRecord, label?: string) => Promise<void>;
  saveRecords: (mutations: LocalMutation[], label?: string) => Promise<void>;
  archiveRecord: (storeName: Parameters<typeof archiveLocalRecord>[1], recordId: string) => Promise<void>;
  applyRemoteSync: (args: {
    mutations: LocalMutation[];
    conflicts: ConflictRecord[];
    syncState: SyncState;
    clearOutbox: boolean;
  }) => Promise<void>;
  markSynced: (syncState: SyncState) => Promise<void>;
}

const BluehourDataContext = createContext<BluehourDataContextValue | undefined>(undefined);

export function BluehourDataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BluehourSnapshot | null>(null);
  const [shellState, setShellState] = useState<ShellState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const nextShell = await loadShellState();
      setShellState(nextShell);

      if (!nextShell.activeProfile) {
        setSnapshot(null);
        return;
      }

      setSnapshot(await loadProfileSnapshot(nextShell.activeProfile));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open Bluehour data");
    } finally {
      setLoading(false);
    }
  }

  async function exploreDemo() {
    const nextShell = await saveShellState({
      activeProfile: "demo",
      applicationState: "demo",
      onboardingStep: "welcome"
    });
    setShellState(nextShell);
    setSnapshot(await loadProfileSnapshot("demo"));
  }

  async function resetDemo() {
    await resetDemoProfile();
    const nextShell = await saveShellState({
      activeProfile: "demo",
      applicationState: "demo",
      onboardingStep: "welcome"
    });
    setShellState(nextShell);
    setSnapshot(await loadProfileSnapshot("demo"));
  }

  async function returnToWelcome() {
    const nextShell = await saveShellState({
      activeProfile: undefined,
      applicationState: "welcome",
      onboardingStep: "welcome"
    });
    setShellState(nextShell);
    setSnapshot(null);
  }

  async function startLiveSetup() {
    await initializeLiveProfile();
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: "setup",
      onboardingStep: "google"
    });
    setShellState(nextShell);
    setSnapshot(await loadProfileSnapshot("live"));
  }

  async function setOnboardingStep(step: OnboardingStep, state: ApplicationState = "setup") {
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: state,
      onboardingStep: step
    });
    setShellState(nextShell);
    setSnapshot(await loadProfileSnapshot("live"));
  }

  async function enterLiveMode() {
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: "live",
      onboardingStep: "start_cycle"
    });
    setShellState(nextShell);
    setSnapshot(await loadProfileSnapshot("live"));
  }

  function requireProfile(): ProfileId {
    if (!shellState?.activeProfile) {
      throw new Error("Choose a Bluehour profile before saving data");
    }
    return shellState.activeProfile;
  }

  async function saveRecords(mutations: LocalMutation[], label = "change") {
    const profileId = requireProfile();
    await putLocalRecords(profileId, mutations, label);
    setSnapshot(await loadProfileSnapshot(profileId));
  }

  async function saveRecord(storeName: MutableStoreName, record: MutableRecord, label = "change") {
    await saveRecords([{ storeName, record }], label);
  }

  async function saveTransaction(draft: TransactionDraft) {
    const profileId = requireProfile();
    if (!snapshot) {
      throw new Error("Bluehour data has not loaded yet");
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

    await putLocalRecords(profileId, mutations, "transaction");
    setSnapshot(await loadProfileSnapshot(profileId));
  }

  async function archiveRecord(storeName: Parameters<typeof archiveLocalRecord>[1], recordId: string) {
    const profileId = requireProfile();
    await archiveLocalRecord(profileId, storeName, recordId);
    setSnapshot(await loadProfileSnapshot(profileId));
  }

  async function applyRemoteSync(args: {
    mutations: LocalMutation[];
    conflicts: ConflictRecord[];
    syncState: SyncState;
    clearOutbox: boolean;
  }) {
    const profileId = requireProfile();
    if (profileId === "demo") {
      throw new Error("Demonstration data cannot be pushed to or pulled from Google Sheets");
    }

    await applyRemoteSyncResult(profileId, args);
    setSnapshot(await loadProfileSnapshot(profileId));
  }

  async function markSynced(syncState: SyncState) {
    const profileId = requireProfile();
    if (profileId === "demo") {
      throw new Error("Demonstration data cannot be marked as Google-synced");
    }

    await clearOutboxAndMarkSynced(profileId, syncState);
    setSnapshot(await loadProfileSnapshot(profileId));
  }

  useEffect(() => {
    void reload();
  }, []);

  const activeProfile = shellState?.activeProfile ?? null;
  const clock = activeProfile === "demo" ? demoClock : browserLocalClock;
  const syncState = snapshot?.syncState.find((state) => state.key === "google");
  const applicationState = deriveApplicationState(shellState?.applicationState ?? "welcome", syncState);
  const isDemo = activeProfile === "demo";

  const value = {
    snapshot,
    shellState,
    applicationState,
    activeProfile,
    profileLabel: activeProfile === "demo" ? "Fictional demonstration" : activeProfile === "live" ? "Live profile" : "No profile",
    isDemo,
    canUseGoogleSync: activeProfile === "live",
    asOfDate: clock.today(),
    clock,
    loading,
    error,
    reload,
    exploreDemo,
    resetDemo,
    returnToWelcome,
    startLiveSetup,
    setOnboardingStep,
    enterLiveMode,
    saveTransaction,
    saveRecord,
    saveRecords,
    archiveRecord,
    applyRemoteSync,
    markSynced
  };

  return <BluehourDataContext.Provider value={value}>{children}</BluehourDataContext.Provider>;
}

export function useBluehourData(): BluehourDataContextValue {
  const value = useContext(BluehourDataContext);
  if (!value) {
    throw new Error("useBluehourData must be used inside BluehourDataProvider");
  }

  return value;
}

function deriveApplicationState(base: ApplicationState, syncState: SyncState | undefined): ApplicationState {
  if (syncState?.status === "read_only_recovery") {
    return "read_only_recovery";
  }

  if (syncState?.status === "conflict") {
    return "sync_conflict";
  }

  if (syncState?.status === "needs_reconnection") {
    return "needs_google_reconnection";
  }

  return base;
}
