import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { browserLocalClock, demoClock, type BluehourClock } from "../../domain/clock";
import type { AppSettings, BluehourSnapshot, ConflictRecord, IsoDate, SyncState } from "../../domain/types";
import {
  applyRemoteSyncResult,
  archiveLocalRecord,
  clearOutboxAndMarkSynced,
  initializeLiveProfile,
  loadProfileSnapshot,
  putLocalRecords,
  replaceProfileSnapshot,
  resetDemoProfile,
  resetLiveProfile,
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
import {
  DRIVE_VAULT_SCHEMA_VERSION,
  createDriveConnectionDescriptor,
  driveVaultFilesFromDescriptor,
  driveVaultFilesFromSyncState,
  parseDriveConnectionDescriptor,
  pushSnapshotToDriveVault,
  readSnapshotFromDriveVault,
  type DriveConnectionDescriptor,
  type DriveVaultFiles
} from "../../data/google/driveAppDataVault";
import { GOOGLE_DRIVE_VAULT_SCOPES, clearInMemoryGoogleAccessToken, getInMemoryGoogleAccessToken } from "../../data/google/googleAuth";
import { planRemoteSnapshotSync } from "../../data/sync/remoteSync";
import { createTransactionRecords, type TransactionCommandResult, type TransactionDraft } from "../../domain/transactions/commands";
import {
  createProfileManifest,
  manifestCheckpointForShell,
  nextManifestForCheckpoint,
  profileManifestSettingRecord,
  readProfileManifest,
  shellStateFromManifest,
  type ManifestOnboardingStep
} from "../../domain/profileManifest";
import {
  inspectProfileHealth,
  liveManifestRepairRecord,
  onboardingManifestRepairRecord,
  planAccidentalOpenCycleArchive
} from "../../domain/profileHealth";
import type { PreparedRemoteRestore } from "../../data/recovery/remoteProfile";
import { createRecordMeta, touchRecord } from "../../domain/records";

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
  deleteLiveDataAndRestart: () => Promise<void>;
  returnToWelcome: () => Promise<void>;
  startLiveSetup: () => Promise<void>;
  startGoogleRecovery: () => Promise<void>;
  setOnboardingStep: (step: OnboardingStep, state?: ApplicationState) => Promise<void>;
  saveRecordsAndAdvanceOnboarding: (mutations: LocalMutation[], step: OnboardingStep, state?: ApplicationState, label?: string) => Promise<void>;
  enterLiveMode: () => Promise<void>;
  saveTransaction: (draft: TransactionDraft) => Promise<TransactionCommandResult>;
  saveRecord: (storeName: MutableStoreName, record: MutableRecord, label?: string) => Promise<void>;
  saveRecords: (mutations: LocalMutation[], label?: string) => Promise<void>;
  archiveRecord: (storeName: Parameters<typeof archiveLocalRecord>[1], recordId: string) => Promise<void>;
  restoreProfileSnapshot: (snapshot: BluehourSnapshot) => Promise<void>;
  restoreRemoteProfile: (restore: PreparedRemoteRestore) => Promise<void>;
  resumeProfileAsLive: () => Promise<void>;
  archiveAccidentalOpenCycleAndResumeOnboarding: () => Promise<void>;
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
  const autoSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSyncInFlight = useRef(false);
  const autoSyncFingerprint = useRef<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      let nextShell = await loadShellState();
      const nextDeviceIdentity = await loadLocalDeviceIdentity();
      setDeviceIdentity(nextDeviceIdentity);

      if (!nextShell.activeProfile) {
        setShellState(nextShell);
        setSnapshot(null);
        return;
      }

      const nextSnapshot = await loadProfileSnapshot(nextShell.activeProfile);
      const reconciledShell = reconcileShellStateForSnapshot(nextShell, nextSnapshot);
      if (reconciledShell) {
        nextShell = await saveShellState(reconciledShell);
      }

      setShellState(nextShell);
      setSnapshot(nextSnapshot);
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

  async function deleteLiveDataAndRestart() {
    clearInMemoryGoogleAccessToken();
    await resetLiveProfile();
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: "setup",
      onboardingStep: "google"
    });
    setShellState(nextShell);
    setSnapshot(await loadProfileSnapshot("live"));
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

  async function saveTransaction(draft: TransactionDraft): Promise<TransactionCommandResult> {
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
    return result;
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

  async function resumeProfileAsLive() {
    assertWritable("profile health repair");
    if (!snapshot) {
      throw new Error("Bluehour data has not loaded yet");
    }
    const manifest = safeReadProfileManifest(snapshot);
    const health = inspectProfileHealth({
      snapshot,
      manifest,
      shell: shellState
        ? {
            applicationState: shellState.applicationState,
            onboardingStep: shellState.onboardingStep
          }
        : null
    });
    if (!health.canResumeAsLive) {
      throw new Error("Profile Health cannot safely resume this profile as live.");
    }

    const record = liveManifestRepairRecord({
      settings: snapshot.settings,
      manifest,
      now: new Date().toISOString(),
      appVersion: __BLUEHOUR_VERSION__,
      deviceId: deviceIdentity?.deviceId
    });
    await putLocalRecords("live", [{ storeName: "settings", record }], "profile health resume as live");
    const nextSnapshot = await loadProfileSnapshot("live");
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: "live",
      onboardingStep: "start_cycle"
    });
    setSnapshot(nextSnapshot);
    setShellState(nextShell);
  }

  async function archiveAccidentalOpenCycleAndResumeOnboarding() {
    assertWritable("profile health repair");
    if (!snapshot) {
      throw new Error("Bluehour data has not loaded yet");
    }
    const now = new Date().toISOString();
    const manifest = safeReadProfileManifest(snapshot);
    const health = inspectProfileHealth({
      snapshot,
      manifest,
      shell: shellState
        ? {
            applicationState: shellState.applicationState,
            onboardingStep: shellState.onboardingStep
          }
        : null
    });
    if (!health.canArchiveAccidentalCycle) {
      throw new Error("Profile Health cannot safely archive the open salary cycle from this profile state.");
    }
    const plan = planAccidentalOpenCycleArchive(snapshot, now);
    if (!plan.safe) {
      throw new Error(plan.reason ?? "Profile Health cannot safely identify the accidental first-cycle records.");
    }
    const manifestRecord = onboardingManifestRepairRecord({
      settings: snapshot.settings,
      manifest,
      now,
      appVersion: __BLUEHOUR_VERSION__,
      deviceId: deviceIdentity?.deviceId,
      lifecycle: "ready_for_salary",
      onboardingStep: "start_cycle"
    });
    const mutations: LocalMutation[] = [
      ...plan.records.budgetCycles.map((record) => ({ storeName: "budgetCycles" as const, record })),
      ...plan.records.budgetAllocations.map((record) => ({ storeName: "budgetAllocations" as const, record })),
      ...plan.records.transactions.map((record) => ({ storeName: "transactions" as const, record })),
      ...plan.records.transactionLegs.map((record) => ({ storeName: "transactionLegs" as const, record })),
      ...plan.records.transactionSplits.map((record) => ({ storeName: "transactionSplits" as const, record })),
      ...plan.records.balanceSnapshots.map((record) => ({ storeName: "balanceSnapshots" as const, record })),
      { storeName: "settings", record: manifestRecord }
    ];
    await putLocalRecords("live", mutations, "profile health archive accidental cycle");
    const nextSnapshot = await loadProfileSnapshot("live");
    const nextShell = await saveShellState({
      activeProfile: "live",
      applicationState: "ready_for_salary",
      onboardingStep: "start_cycle"
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

  const pushDriveSnapshotAndMarkSynced = useCallback(
    async (
      snapshotToSync: BluehourSnapshot,
      files: DriveVaultFiles,
      descriptor: DriveConnectionDescriptor | null | undefined,
      token: string,
      nextRemoteRevision: number,
      expectedRemoteRevision: number,
      message: string
    ) => {
      await pushSnapshotToDriveVault(files, snapshotToSync, token, fetch, nextRemoteRevision, expectedRemoteRevision);
      const syncedAt = new Date().toISOString();
      const descriptorMutation = driveDescriptorMutation(snapshotToSync, files, descriptor, nextRemoteRevision, syncedAt);
      await applyRemoteSyncResult("live", {
        mutations: descriptorMutation ? [descriptorMutation] : [],
        conflicts: [],
        syncState: driveSyncState(snapshotToSync, files, descriptor, {
          key: "google",
          provider: "drive_appdata",
          status: "synced",
          remoteRevision: nextRemoteRevision,
          lastSyncedAt: syncedAt,
          message
        }),
        clearOutbox: true
      });
      setSnapshot(await loadProfileSnapshot("live"));
    },
    []
  );

  const autoSyncDriveSnapshot = useCallback(async (snapshotToSync: BluehourSnapshot) => {
    const syncState = snapshotToSync.syncState.find((state) => state.key === "google");
    const connection = driveConnectionFromSnapshot(snapshotToSync);
    const files = connection?.files ?? driveVaultFilesFromSyncState(syncState);
    if (!syncState || syncState.status === "needs_reconnection" || !files) {
      return;
    }

    const token = getInMemoryGoogleAccessToken(GOOGLE_DRIVE_VAULT_SCOPES);
    if (!token) {
      await applyRemoteSyncResult("live", {
        mutations: [],
        conflicts: [],
        syncState: {
          ...syncState,
          key: "google",
          status: "needs_reconnection",
          message: "Google session expired after one hour. Sign in to resume automatic sync."
        },
        clearOutbox: false
      });
      setSnapshot(await loadProfileSnapshot("live"));
      return;
    }

    const remote = await readSnapshotFromDriveVault(files, token);
    if (!remote) {
      await pushDriveSnapshotAndMarkSynced(snapshotToSync, files, connection?.descriptor, token, 1, 0, "Auto-synced to Google Drive.");
      return;
    }

    const plan = planRemoteSnapshotSync(snapshotToSync, remote, {
      supportedSchemaVersion: DRIVE_VAULT_SCHEMA_VERSION,
      remoteLabel: "Google Drive vault"
    });

    if (plan.action === "push_local") {
      await pushDriveSnapshotAndMarkSynced(
        snapshotToSync,
        files,
        connection?.descriptor,
        token,
        plan.nextRemoteRevision,
        plan.remoteRevision,
        "Auto-synced to Google Drive."
      );
      return;
    }

    const now = new Date().toISOString();
    const mutations = [...plan.mutations];
    const descriptorMutation = driveDescriptorMutation(snapshotToSync, files, connection?.descriptor, plan.remoteRevision, now);
    if (descriptorMutation) {
      mutations.push(descriptorMutation);
    }
    await applyRemoteSyncResult("live", {
      mutations,
      conflicts: plan.conflicts,
      syncState: driveSyncState(snapshotToSync, files, connection?.descriptor, {
        ...plan.syncState,
        provider: "drive_appdata",
        driveManifestFileId: files.manifestFileId,
        driveSlotAFileId: files.slotAFileId,
        driveSlotBFileId: files.slotBFileId,
        lastRemoteWriterDeviceId: remote.lastWrittenByDeviceId
      }),
      clearOutbox: plan.clearOutbox
    });
    setSnapshot(await loadProfileSnapshot("live"));
  }, [pushDriveSnapshotAndMarkSynced]);

  useEffect(() => {
    void reload();
  }, []);

  const activeProfile = shellState?.activeProfile ?? null;
  const clock = activeProfile === "demo" ? demoClock : browserLocalClock;
  const syncState = snapshot?.syncState.find((state) => state.key === "google");
  const applicationState = deriveApplicationState(shellState?.applicationState ?? "welcome", syncState);
  const isDemo = activeProfile === "demo";

  useEffect(() => {
    if (autoSyncTimer.current) {
      clearTimeout(autoSyncTimer.current);
      autoSyncTimer.current = null;
    }

    if (!snapshot || activeProfile !== "live" || loading || !shouldAttemptDriveAutoSync(snapshot, applicationState)) {
      return;
    }

    const fingerprint = driveAutoSyncFingerprint(snapshot);
    if (autoSyncInFlight.current || autoSyncFingerprint.current === fingerprint) {
      return;
    }

    autoSyncTimer.current = setTimeout(() => {
      autoSyncTimer.current = null;
      autoSyncInFlight.current = true;
      autoSyncFingerprint.current = fingerprint;
      void autoSyncDriveSnapshot(snapshot).catch((caught) => {
        const currentSyncState = snapshot.syncState.find((state) => state.key === "google");
        if (!currentSyncState) {
          return;
        }
        void applyRemoteSyncResult("live", {
          mutations: [],
          conflicts: [],
          syncState: {
            ...currentSyncState,
            key: "google",
            status: "needs_reconnection",
            message: caught instanceof Error ? `Automatic Google sync paused: ${caught.message}` : "Automatic Google sync paused."
          },
          clearOutbox: false
        }).then(async () => setSnapshot(await loadProfileSnapshot("live")));
      }).finally(() => {
        autoSyncInFlight.current = false;
      });
    }, 900);

    return () => {
      if (autoSyncTimer.current) {
        clearTimeout(autoSyncTimer.current);
        autoSyncTimer.current = null;
      }
    };
  }, [snapshot, activeProfile, applicationState, loading, autoSyncDriveSnapshot]);

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
    deleteLiveDataAndRestart,
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
    resumeProfileAsLive,
    archiveAccidentalOpenCycleAndResumeOnboarding,
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

export function deriveApplicationState(base: ApplicationState, syncState: SyncState | undefined): ApplicationState {
  if (syncState?.status === "read_only_recovery") {
    return "read_only_recovery";
  }

  if (syncState?.status === "conflict") {
    return "sync_conflict";
  }

  if (syncState?.status === "needs_reconnection" && base === "live") {
    return "needs_google_reconnection";
  }

  return base;
}

export function reconcileShellStateForSnapshot(
  shell: ShellState,
  snapshot: BluehourSnapshot
): Partial<Omit<ShellState, "key" | "updatedAt">> | null {
  if (shell.activeProfile !== "live" || shell.applicationState !== "live" || hasOpenSalaryCycle(snapshot)) {
    return null;
  }

  const manifestShell = readManifestShellState(snapshot);
  const next =
    manifestShell && manifestShell.applicationState !== "live"
      ? manifestShell
      : {
          applicationState: "ready_for_salary" as const,
          onboardingStep: "start_cycle" as const
        };

  if (shell.applicationState === next.applicationState && shell.onboardingStep === next.onboardingStep) {
    return null;
  }

  return next;
}

function hasOpenSalaryCycle(snapshot: Pick<BluehourSnapshot, "budgetCycles">): boolean {
  return snapshot.budgetCycles.some((cycle) => !cycle.archivedAt && cycle.status === "open");
}

function readManifestShellState(snapshot: BluehourSnapshot): ReturnType<typeof shellStateFromManifest> | null {
  try {
    const manifest = readProfileManifest(snapshot.settings);
    return manifest ? shellStateFromManifest(manifest) : null;
  } catch {
    return null;
  }
}

function safeReadProfileManifest(snapshot: BluehourSnapshot): ReturnType<typeof readProfileManifest> {
  try {
    return readProfileManifest(snapshot.settings);
  } catch {
    return null;
  }
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

function shouldAttemptDriveAutoSync(snapshot: BluehourSnapshot, applicationState: ApplicationState): boolean {
  if (applicationState === "read_only_recovery" || applicationState === "sync_conflict") {
    return false;
  }

  if (snapshot.outboxOperations.length === 0) {
    return false;
  }

  const syncState = snapshot.syncState.find((state) => state.key === "google");
  if (!syncState || syncState.status === "demo" || syncState.status === "saved_locally" || syncState.status === "needs_reconnection") {
    return false;
  }

  return Boolean(driveConnectionFromSnapshot(snapshot) || driveVaultFilesFromSyncState(syncState));
}

function driveAutoSyncFingerprint(snapshot: BluehourSnapshot): string {
  const syncState = snapshot.syncState.find((state) => state.key === "google");
  return [
    syncState?.remoteRevision ?? 0,
    syncState?.status ?? "missing",
    ...snapshot.outboxOperations.map((operation) => `${operation.id}:${operation.tableName}:${operation.recordId}`).sort()
  ].join("|");
}

function driveConnectionFromSnapshot(
  snapshot: BluehourSnapshot
): { setting: AppSettings; descriptor: DriveConnectionDescriptor; files: DriveVaultFiles } | null {
  const setting = snapshot.settings.find((candidate) => candidate.key === "googleConnection" && !candidate.archivedAt);
  if (!setting) {
    return null;
  }

  try {
    const descriptor = parseDriveConnectionDescriptor(JSON.parse(setting.valueJson));
    return {
      setting,
      descriptor,
      files: driveVaultFilesFromDescriptor(descriptor)
    };
  } catch {
    return null;
  }
}

function driveDescriptorMutation(
  snapshot: BluehourSnapshot,
  files: DriveVaultFiles,
  descriptor: DriveConnectionDescriptor | null | undefined,
  remoteRevision: number,
  lastSuccessfulSyncAt: string
): LocalMutation | null {
  const manifest = readProfileManifest(snapshot.settings);
  if (!manifest) {
    return null;
  }

  const existingSetting = snapshot.settings.find((setting) => setting.key === "googleConnection" && !setting.archivedAt);
  const valueJson = JSON.stringify(
    createDriveConnectionDescriptor(files, {
      profileId: manifest.profileId,
      googleSubject: descriptor?.googleSubject,
      googleEmail: descriptor?.googleEmail,
      googleName: descriptor?.googleName,
      lastKnownRemoteRevision: remoteRevision,
      lastSuccessfulSyncAt
    })
  );
  const record: AppSettings = existingSetting
    ? {
        ...touchRecord(existingSetting),
        valueJson
      }
    : {
        ...createRecordMeta("settings"),
        key: "googleConnection",
        valueJson
      };
  return { storeName: "settings", record, outbox: false };
}

function driveSyncState(
  snapshot: BluehourSnapshot,
  files: DriveVaultFiles,
  descriptor: DriveConnectionDescriptor | null | undefined,
  nextState: SyncState
): SyncState {
  const current = snapshot.syncState.find((state) => state.key === "google");
  const manifest = readProfileManifest(snapshot.settings);
  return {
    ...current,
    ...nextState,
    key: "google",
    provider: "drive_appdata",
    driveManifestFileId: files.manifestFileId,
    driveSlotAFileId: files.slotAFileId,
    driveSlotBFileId: files.slotBFileId,
    googleSubject: current?.googleSubject ?? descriptor?.googleSubject,
    googleEmail: current?.googleEmail ?? descriptor?.googleEmail,
    googleName: current?.googleName ?? descriptor?.googleName,
    profileId: manifest?.profileId ?? current?.profileId ?? descriptor?.profileId
  };
}
