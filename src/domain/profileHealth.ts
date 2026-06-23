import { addDays } from "./dates";
import {
  createProfileManifest,
  hasMeaningfulProfileData,
  nextManifestForCheckpoint,
  profileManifestSettingRecord,
  shellStateFromManifest,
  type BluehourProfileManifest,
  type ManifestOnboardingStep,
  type RemoteProfileLifecycle
} from "./profileManifest";
import { touchRecord } from "./records";
import type {
  AppSettings,
  BalanceSnapshot,
  BluehourSnapshot,
  BudgetAllocation,
  BudgetCycle,
  Transaction,
  TransactionLeg,
  TransactionSplit,
  UtcIsoTimestamp
} from "./types";
import { isActive } from "./types";

export type ProfileHealthStatus =
  | "healthy"
  | "manifest_missing"
  | "manifest_onboarding_but_cycle_open"
  | "manifest_live_but_no_cycle"
  | "multiple_open_cycles"
  | "ready_for_salary_but_cycle_open"
  | "shell_manifest_mismatch"
  | "unsupported_remote_schema"
  | "unrepairable";

export type ProfileRepairOption =
  | "resume_as_live"
  | "resume_onboarding"
  | "archive_accidental_open_cycle"
  | "create_missing_manifest"
  | "reset_local_live_profile"
  | "reset_drive_vault"
  | "export_backup"
  | "enter_read_only_recovery";

export interface ProfileHealthIssue {
  id: ProfileHealthStatus;
  severity: "info" | "warning" | "danger";
  title: string;
  explanation: string[];
  repairOptions: ProfileRepairOption[];
}

export interface ProfileHealthShellState {
  applicationState: "setup" | "ready_for_salary" | "live" | "read_only_recovery" | "welcome" | "demo" | "connect_existing" | "needs_google_reconnection" | "sync_conflict";
  onboardingStep?: ManifestOnboardingStep | "welcome";
}

export interface ProfileHealthResult {
  status: ProfileHealthStatus;
  issues: ProfileHealthIssue[];
  manifestLifecycle: RemoteProfileLifecycle | "missing";
  onboardingStep?: ManifestOnboardingStep;
  openCycleCount: number;
  closedCycleCount: number;
  meaningfulData: boolean;
  canResumeAsLive: boolean;
  canArchiveAccidentalCycle: boolean;
}

export interface AccidentalCycleArchivePlan {
  safe: boolean;
  reason?: string;
  cycle?: BudgetCycle;
  records: {
    budgetCycles: BudgetCycle[];
    budgetAllocations: BudgetAllocation[];
    transactions: Transaction[];
    transactionLegs: TransactionLeg[];
    transactionSplits: TransactionSplit[];
    balanceSnapshots: BalanceSnapshot[];
  };
}

export function inspectProfileHealth({
  snapshot,
  manifest,
  shell,
  remoteSchemaVersion,
  supportedRemoteSchemaVersion
}: {
  snapshot: Pick<
    BluehourSnapshot,
    | "accounts"
    | "transactions"
    | "budgetCycles"
    | "planInstances"
    | "subscriptions"
    | "budgetAllocations"
    | "balanceSnapshots"
    | "transactionLegs"
    | "transactionSplits"
  >;
  manifest: BluehourProfileManifest | null;
  shell?: ProfileHealthShellState | null;
  remoteSchemaVersion?: number;
  supportedRemoteSchemaVersion?: number;
}): ProfileHealthResult {
  const openCycles = activeOpenCycles(snapshot.budgetCycles);
  const closedCycles = snapshot.budgetCycles.filter((cycle) => isActive(cycle) && cycle.status === "closed");
  const meaningfulData = hasMeaningfulProfileData(snapshot);
  const issues: ProfileHealthIssue[] = [];

  if (remoteSchemaVersion !== undefined && supportedRemoteSchemaVersion !== undefined && remoteSchemaVersion > supportedRemoteSchemaVersion) {
    issues.push({
      id: "unsupported_remote_schema",
      severity: "danger",
      title: "Remote vault schema is newer",
      explanation: [
        `The Google Drive vault schema is ${remoteSchemaVersion}, but this Bluehour build supports ${supportedRemoteSchemaVersion}.`,
        "Writes are paused to avoid corrupting data from a newer app build."
      ],
      repairOptions: ["enter_read_only_recovery", "export_backup"]
    });
  }

  if (openCycles.length > 1) {
    issues.push({
      id: "multiple_open_cycles",
      severity: "danger",
      title: "Multiple open salary cycles",
      explanation: [
        "More than one open salary cycle exists.",
        "Bluehour cannot safely choose one cycle automatically, so the profile should be opened in read-only recovery."
      ],
      repairOptions: ["enter_read_only_recovery", "export_backup"]
    });
  }

  if (!manifest) {
    issues.push({
      id: "manifest_missing",
      severity: meaningfulData ? "warning" : "info",
      title: meaningfulData ? "Profile manifest is missing" : "Profile manifest has not been created yet",
      explanation: meaningfulData
        ? ["Financial or setup records exist, but the typed profile manifest is missing.", "Bluehour can create a manifest from the records after confirmation."]
        : ["No meaningful local profile records were found.", "Starting setup will create a new typed profile manifest."],
      repairOptions: openCycles.length === 1 ? ["resume_as_live", "create_missing_manifest", "export_backup"] : ["create_missing_manifest", "resume_onboarding"]
    });
  } else if (manifest.lifecycle === "setup" && openCycles.length === 1) {
    issues.push(setupOpenCycleIssue("manifest_onboarding_but_cycle_open"));
  } else if (manifest.lifecycle === "ready_for_salary" && openCycles.length === 1) {
    issues.push(setupOpenCycleIssue("ready_for_salary_but_cycle_open"));
  } else if (manifest.lifecycle === "live" && openCycles.length === 0 && closedCycles.length === 0) {
    issues.push({
      id: "manifest_live_but_no_cycle",
      severity: "warning",
      title: "Live manifest without salary-cycle history",
      explanation: [
        "The profile manifest says the profile is live, but no open or closed salary cycle exists.",
        "Bluehour can resume the first-cycle setup step without deleting records."
      ],
      repairOptions: ["resume_onboarding", "export_backup"]
    });
  }

  if (manifest && shell && shell.applicationState !== "welcome" && shell.applicationState !== "demo" && shell.applicationState !== "connect_existing") {
    const expected = shellStateFromManifest(manifest);
    if (shell.applicationState !== expected.applicationState || (shell.onboardingStep && shell.onboardingStep !== expected.onboardingStep)) {
      issues.push({
        id: "shell_manifest_mismatch",
        severity: "warning",
        title: "Browser shell state differs from the profile manifest",
        explanation: [
          `The local browser shell says ${shell.applicationState}, while the manifest says ${manifest.lifecycle}.`,
          "Bluehour can rebuild the shell state from the manifest and records."
        ],
        repairOptions: openCycles.length === 1 ? ["resume_as_live", "resume_onboarding"] : ["resume_onboarding"]
      });
    }
  }

  const status = highestStatus(issues);
  const archivePlan = planAccidentalOpenCycleArchive(snapshot, "1970-01-01T00:00:00.000Z");
  const canArchiveAccidentalCycle =
    archivePlan.safe && issues.some((issue) => issue.repairOptions.includes("archive_accidental_open_cycle"));
  return {
    status,
    issues,
    manifestLifecycle: manifest?.lifecycle ?? "missing",
    onboardingStep: manifest?.onboardingStep,
    openCycleCount: openCycles.length,
    closedCycleCount: closedCycles.length,
    meaningfulData,
    canResumeAsLive: canResumeAsLive(manifest, openCycles.length),
    canArchiveAccidentalCycle
  };
}

export function canResumeAsLive(manifest: BluehourProfileManifest | null, openCycleCount: number): boolean {
  return openCycleCount === 1 && (!manifest || manifest.lifecycle === "setup" || manifest.lifecycle === "ready_for_salary");
}

export function liveManifestRepairRecord({
  settings,
  manifest,
  now,
  appVersion,
  deviceId
}: {
  settings: readonly AppSettings[];
  manifest: BluehourProfileManifest | null;
  now: UtcIsoTimestamp;
  appVersion: string;
  deviceId?: string;
}): AppSettings {
  const current =
    manifest ??
    createProfileManifest({
      now,
      appVersion,
      deviceId,
      lifecycle: "live"
    });
  const next = nextManifestForCheckpoint({
    current,
    now,
    appVersion,
    deviceId,
    lifecycle: "live"
  });
  return profileManifestSettingRecord(settings, next);
}

export function onboardingManifestRepairRecord({
  settings,
  manifest,
  now,
  appVersion,
  deviceId,
  onboardingStep = "start_cycle",
  lifecycle = "ready_for_salary"
}: {
  settings: readonly AppSettings[];
  manifest: BluehourProfileManifest | null;
  now: UtcIsoTimestamp;
  appVersion: string;
  deviceId?: string;
  onboardingStep?: ManifestOnboardingStep;
  lifecycle?: Extract<RemoteProfileLifecycle, "setup" | "ready_for_salary">;
}): AppSettings {
  const current =
    manifest ??
    createProfileManifest({
      now,
      appVersion,
      deviceId,
      lifecycle,
      onboardingStep
    });
  const next = nextManifestForCheckpoint({
    current,
    now,
    appVersion,
    deviceId,
    lifecycle,
    onboardingStep
  });
  return profileManifestSettingRecord(settings, next);
}

export function planAccidentalOpenCycleArchive(
  snapshot: Pick<BluehourSnapshot, "budgetCycles" | "budgetAllocations" | "transactions" | "transactionLegs" | "transactionSplits" | "balanceSnapshots">,
  now: UtcIsoTimestamp
): AccidentalCycleArchivePlan {
  const openCycles = activeOpenCycles(snapshot.budgetCycles);
  const emptyRecords = {
    budgetCycles: [],
    budgetAllocations: [],
    transactions: [],
    transactionLegs: [],
    transactionSplits: [],
    balanceSnapshots: []
  };

  if (openCycles.length !== 1) {
    return { safe: false, reason: "Expected exactly one open salary cycle.", records: emptyRecords };
  }

  const cycle = openCycles[0];
  const salaryTransaction = snapshot.transactions.find((transaction) => isActive(transaction) && transaction.id === cycle.salaryTransactionId);
  if (!salaryTransaction || salaryTransaction.type !== "income" || salaryTransaction.description !== "Main salary") {
    return { safe: false, reason: "The open cycle salary transaction could not be identified safely.", cycle, records: emptyRecords };
  }

  const salaryLegs = snapshot.transactionLegs.filter((leg) => isActive(leg) && leg.transactionId === salaryTransaction.id);
  const salarySplits = snapshot.transactionSplits.filter((split) => isActive(split) && split.transactionId === salaryTransaction.id);
  if (salaryLegs.length === 0 || salarySplits.length === 0) {
    return { safe: false, reason: "The salary transaction legs or splits are incomplete.", cycle, records: emptyRecords };
  }

  const openingSnapshots = snapshot.balanceSnapshots.filter(
    (snapshotRecord) =>
      isActive(snapshotRecord) &&
      snapshotRecord.source === "opening" &&
      snapshotRecord.asOfDate === addDays(cycle.startedOn, -1) &&
      salaryLegs.some((leg) => leg.accountId === snapshotRecord.accountId) &&
      /Derived from current balance minus salary deposit/i.test(snapshotRecord.note ?? "")
  );

  return {
    safe: true,
    cycle,
    records: {
      budgetCycles: [{ ...touchRecord(cycle), archivedAt: now }],
      budgetAllocations: snapshot.budgetAllocations
        .filter((allocation) => isActive(allocation) && allocation.budgetCycleId === cycle.id)
        .map((allocation) => ({ ...touchRecord(allocation), archivedAt: now, note: appendRepairNote(allocation.note, "Archived by Profile Health repair.") })),
      transactions: [{ ...touchRecord(salaryTransaction), archivedAt: now, note: appendRepairNote(salaryTransaction.note, "Archived by Profile Health repair.") }],
      transactionLegs: salaryLegs.map((leg) => ({ ...touchRecord(leg), archivedAt: now })),
      transactionSplits: salarySplits.map((split) => ({ ...touchRecord(split), archivedAt: now })),
      balanceSnapshots: openingSnapshots.map((snapshotRecord) => ({
        ...touchRecord(snapshotRecord),
        archivedAt: now,
        note: appendRepairNote(snapshotRecord.note, "Archived by Profile Health repair.")
      }))
    }
  };
}

function setupOpenCycleIssue(id: "manifest_onboarding_but_cycle_open" | "ready_for_salary_but_cycle_open"): ProfileHealthIssue {
  return {
    id,
    severity: "warning",
    title: "A salary cycle already exists",
    explanation: [
      "Bluehour found one open salary cycle, but setup has not been marked complete.",
      "This usually means the first salary-cycle start was interrupted after the records were saved.",
      "The safe repair is to resume as a live profile without changing financial records."
    ],
    repairOptions: ["resume_as_live", "archive_accidental_open_cycle", "export_backup", "reset_local_live_profile", "reset_drive_vault"]
  };
}

function activeOpenCycles(cycles: readonly BudgetCycle[]): BudgetCycle[] {
  return cycles.filter((cycle) => isActive(cycle) && cycle.status === "open");
}

function highestStatus(issues: readonly ProfileHealthIssue[]): ProfileHealthStatus {
  const danger = issues.find((issue) => issue.severity === "danger");
  if (danger) {
    return danger.id;
  }
  const warning = issues.find((issue) => issue.severity === "warning");
  if (warning) {
    return warning.id;
  }
  const info = issues.find((issue) => issue.severity === "info");
  return info?.id ?? "healthy";
}

function appendRepairNote(note: string | undefined, repairNote: string): string {
  return note ? `${note} ${repairNote}` : repairNote;
}
