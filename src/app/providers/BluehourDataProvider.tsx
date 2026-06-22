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
  replaceProfileSnapshot,
  resetDemoProfile,
  type LocalMutation,
  type MutableRecord,
  type MutableStoreName,
  type ProfileId
} from "../../data/local-db/localDb";
import {
  loadLocalDeviceIdentity,
  loadShellState,
  saveShellState,
  type ApplicationState,
  type LocalDeviceIdentity,
  type OnboardingStep,
  type ShellState
} from "../../data/local-db/shellDb";
import { createTransactionRecords, type TransactionDraft } from "../../domain/transactions/commands";
import {
  createProfileManifest,
  manifestCheckpointForShell,
  nextManifestForCheckpoint,
  profileManifestSettingRecord,
  readProfileManifest,
  type ManifestOnboardingStep
} from "../../domain/profileManifest";
import type { PreparedRemoteRestore } from "../../data/recovery/remoteProfile";

interface BluehourDataContextValue {
  snapshot: BluehourSnapshot | null;
  shellState: ShellState | null;
  deviceIdentity: LocalDeviceIdentity | null;
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
  startGoogleRecovery: () => Promise<void>;
  setOnboardingStep: (step: OnboardingStep, state?: ApplicationState) => Promise<void>;
  saveRecordsAndAdvanceOnboarding: (mutations: LocalMutation[], step: OnboardingStep, state?: ApplicationState, label?: string) => Promise<void>;
  enterLiveMode: () => Promise<void>;
  saveTransaction: (draft: TransactionDraft) => Promise<void>;
  saveRecord: (storeName: MutableStoreName, record: MutableRecord, label?: string) => Promise<void>;
  saveRecords: (mutations: LocalMutation[], label?: string) => Promise<void>;
  archiveRecord: (storeName: Parameters<typeof archiveLocalRecord>[1], recordId: string) => Promise<void>;
  restoreProfileSnapshot: (snapshot: BluehourSnapshot) => Promise<void>;
  restoreRemoteProfile: (restore: PreparedRemoteRestore) => Promise<void>;
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
  const [deviceIdentity, setDeviceIdentity] = useState<LocalDeviceIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const nextShell = await loadShellState();
      const nextDeviceIdentity = await loadLocalDeviceIdentity();
      setShellState(nextShell);
      setDeviceIdentity(nextDeviceIdentity);

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

  async function startGoogleRecovery() {
    const nextShell = await saveShellState({
      activeProfile: undefined,
      applicationState: "connect_existing",
      onboardingStep: "welcome"
    });
    setShellState(nextShell);
    setSnapshot(null);
  }

  async function setOnboardingStep(step: OnboardingStep, state: ApplicationState = "setup") {
    if (snapshot && shellState?.activeProfile === "live" && isManifestStep(step)) {
      await putLocalRecords("live", [manifestMutation(snapshot, step, state, deviceIdentity?.deviceId)], "onboarding checkpoint");
    }
    const nextSnapshot = await loadProfileSnapshot("live");
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: state,
      onboardingStep: step
    });
    setSnapshot(nextSnapshot);
    setShellState(nextShell);
  }

  async function saveRecordsAndAdvanceOnboarding(mutations: LocalMutation[], step: OnboardingStep, state: ApplicationState = "setup", label = "onboarding") {
    assertWritable(label);
    if (!snapshot) {
      throw new Error("Bluehour data has not loaded yet");
    }
    if (!isManifestStep(step)) {
      throw new Error("Onboarding checkpoint is invalid");
    }
    await putLocalRecords("live", [...mutations, manifestMutation(snapshot, step, state, deviceIdentity?.deviceId)], label);
    const nextSnapshot = await loadProfileSnapshot("live");
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: state,
      onboardingStep: step
    });
    setSnapshot(nextSnapshot);
    setShellState(nextShell);
  }

  async function enterLiveMode() {
    if (snapshot && shellState?.activeProfile === "live") {
      await putLocalRecords("live", [manifestMutation(snapshot, "start_cycle", "live", deviceIdentity?.deviceId)], "live profile start");
    }
    const nextSnapshot = await loadProfileSnapshot("live");
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: "live",
      onboardingStep: "start_cycle"
    });
    setSnapshot(nextSnapshot);
    setShellState(nextShell);
  }

  function requireProfile(): ProfileId {
    if (!shellState?.activeProfile) {
      throw new Error("Choose a Bluehour profile before saving data");
    }
    return shellState.activeProfile;
  }

  function currentApplicationState(): ApplicationState {
    const syncState = snapshot?.syncState.find((state) => state.key === "google");
    return deriveApplicationState(shellState?.applicationState ?? "welcome", syncState);
  }

  function assertWritable(label: string) {
    const state = currentApplicationState();
    if (state === "read_only_recovery") {
      throw new Error("Bluehour is in read-only recovery. Exports remain available, but writes are paused until recovery is complete.");
    }

    if (state === "sync_conflict" && label !== "conflict resolution") {
      throw new Error("Resolve the Google sync conflict before making new local changes.");
    }
  }

  async function saveRecords(mutations: LocalMutation[], label = "change") {
    assertWritable(label);
    const profileId = requireProfile();
    await putLocalRecords(profileId, mutations, label);
    setSnapshot(await loadProfileSnapshot(profileId));
  }

  async function saveRecord(storeName: MutableStoreName, record: MutableRecord, label = "change") {
    await saveRecords([{ storeName, record }], label);
  }

  async function saveTransaction(draft: TransactionDraft) {
    assertWritable("transaction");
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
    assertWritable("archive");
    const profileId = requireProfile();
    await archiveLocalRecord(profileId, storeName, recordId);
    setSnapshot(await loadProfileSnapshot(profileId));
  }

  async function restoreProfileData(restoredSnapshot: BluehourSnapshot) {
    assertWritable("backup restore");
    const profileId = requireProfile();
    await replaceProfileSnapshot(profileId, restoredSnapshot);
    setSnapshot(await loadProfileSnapshot(profileId));
  }

  async function restoreRemoteProfile(restore: PreparedRemoteRestore) {
    await replaceProfileSnapshot("live", restore.snapshot);
    const nextSnapshot = await loadProfileSnapshot("live");
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: restore.shell.applicationState,
      onboardingStep: restore.shell.onboardingStep
    });
    setSnapshot(nextSnapshot);
    setShellState(nextShell);
  }

  async function applyRemoteSync(args: {
    mutations: LocalMutation[];
    conflicts: ConflictRecord[];
    syncState: SyncState;
    clearOutbox: boolean;
  }) {
    const profileId = requireProfile();
    if (currentApplicationState() === "read_only_recovery") {
      throw new Error("Bluehour is in read-only recovery. Google sync writes are paused.");
    }
    if (profileId === "demo") {
      throw new Error("Demonstration data cannot be pushed to or pulled from Google");
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
    deviceIdentity,
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
    startGoogleRecovery,
    setOnboardingStep,
    saveRecordsAndAdvanceOnboarding,
    enterLiveMode,
    saveTransaction,
    saveRecord,
    saveRecords,
    archiveRecord,
    restoreProfileSnapshot: restoreProfileData,
    restoreRemoteProfile,
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

function isManifestStep(step: OnboardingStep): step is ManifestOnboardingStep {
  return step !== "welcome";
}

function manifestMutation(snapshot: BluehourSnapshot, step: ManifestOnboardingStep, state: ApplicationState, deviceId?: string): LocalMutation {
  const now = new Date().toISOString();
  const checkpoint = manifestCheckpointForShell(
    step,
    state === "ready_for_salary" || state === "live" || state === "read_only_recovery" ? state : "setup"
  );
  const current =
    readProfileManifest(snapshot.settings) ??
    createProfileManifest({
      now,
      appVersion: __BLUEHOUR_VERSION__
    });
  const next = nextManifestForCheckpoint({
    current,
    now,
    appVersion: __BLUEHOUR_VERSION__,
    deviceId,
    lifecycle: checkpoint.lifecycle,
    onboardingStep: checkpoint.onboardingStep
  });
  return {
    storeName: "settings",
    record: profileManifestSettingRecord(snapshot.settings, next)
  };
}
