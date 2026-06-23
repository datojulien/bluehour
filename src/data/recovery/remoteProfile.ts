import { createRecordMeta, touchRecord } from "../../domain/records";
import type { AppSettings, BluehourSnapshot, SyncState } from "../../domain/types";
import {
  createProfileManifest,
  hasMeaningfulProfileData,
  inferLegacyLifecycle,
  profileManifestSettingRecord,
  readProfileManifest,
  shellStateFromManifest,
  validateManifestAgainstSnapshot,
  type BluehourProfileManifest,
  type LegacyLifecycleInference,
  type ManifestOnboardingStep,
  type RemoteProfileLifecycle
} from "../../domain/profileManifest";
import {
  BLUEHOUR_SCHEMA_VERSION,
  createConnectionDescriptor,
  extractSpreadsheetId,
  readGoogleSpreadsheetTabTitles
} from "../google/googleSheetsAdapter";
import { readSnapshotFromGoogleSheet, type RemoteSheetSnapshot } from "../google/sheetSerialization";

export interface RemoteProfileCounts {
  accounts: number;
  transactions: number;
  budgetCycles: number;
  planInstances: number;
  subscriptions: number;
}

export interface RemoteProfileInspection {
  spreadsheetId: string;
  remoteRevision: number;
  schemaVersion: number;
  activeSlot?: "A" | "B";
  exportedAt?: string;
  manifest: BluehourProfileManifest | null;
  legacyInference?: LegacyLifecycleInference;
  snapshot: BluehourSnapshot;
  counts: RemoteProfileCounts;
  warnings: string[];
  consistencyErrors: string[];
  meaningfulRemoteData: boolean;
}

export interface PreparedRemoteRestore {
  snapshot: BluehourSnapshot;
  manifest: BluehourProfileManifest;
  shell: ReturnType<typeof shellStateFromManifest>;
}

const EMPTY_SNAPSHOT: BluehourSnapshot = {
  accounts: [],
  balanceSnapshots: [],
  transactions: [],
  transactionLegs: [],
  transactionSplits: [],
  categories: [],
  budgetCycles: [],
  budgetAllocations: [],
  budgetTransfers: [],
  recurringRules: [],
  planInstances: [],
  subscriptions: [],
  extraIncomeAllocations: [],
  savingsGoals: [],
  savingsGoalContributions: [],
  coachInsightDecisions: [],
  purchaseChecks: [],
  categorisationRules: [],
  importProfiles: [],
  importBatches: [],
  importRowAudits: [],
  reconciliations: [],
  reviewSessions: [],
  settings: [],
  outboxOperations: [],
  conflicts: [],
  syncState: []
};

export async function inspectRemoteBluehourSheet(
  input: string,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<RemoteProfileInspection> {
  const spreadsheetId = extractSpreadsheetId(input);
  validateSpreadsheetId(spreadsheetId);

  const titles = await readGoogleSpreadsheetTabTitles(spreadsheetId, accessToken, fetcher);
  if (!resemblesBluehourSheet(titles)) {
    throw new Error("This Sheet does not look like a supported Bluehour Sheet. No local data was changed.");
  }

  const remote = await readSnapshotFromGoogleSheet(spreadsheetId, accessToken, fetcher);
  return inspectRemoteSnapshot(spreadsheetId, remote);
}

export function inspectRemoteSnapshot(spreadsheetId: string, remote: RemoteSheetSnapshot): RemoteProfileInspection {
  validateSpreadsheetId(spreadsheetId);
  const snapshot = completeSnapshot(remote.snapshot);
  const warnings: string[] = [];
  let legacyInference: LegacyLifecycleInference | undefined;

  if ((remote.schemaVersion ?? 1) > BLUEHOUR_SCHEMA_VERSION) {
    warnings.push(`Google Sheet schema ${remote.schemaVersion} is newer than this Bluehour build supports. Open read-only recovery before writing.`);
  }

  const manifest = readRemoteProfileManifest(snapshot.settings);

  if (!manifest) {
    legacyInference = inferLegacyLifecycle(snapshot);
    warnings.push("This looks like a legacy Bluehour Sheet without a synced profile manifest.");
    warnings.push(...legacyInference.warnings);
  }

  if (!hasMeaningfulProfileData(snapshot)) {
    warnings.push("This Sheet does not yet contain a committed Bluehour profile.");
  }

  if (snapshot.budgetCycles.filter((cycle) => !cycle.archivedAt && cycle.status === "open").length > 1) {
    warnings.push("More than one open salary cycle was found.");
  }

  if (containsDemoIdentifiers(snapshot)) {
    warnings.push("Remote data contains fictional demonstration identifiers. Confirm before restoring it into the live profile.");
  }

  const consistencyErrors = manifest ? validateManifestAgainstSnapshot(manifest, snapshot) : [];

  return {
    spreadsheetId,
    remoteRevision: remote.remoteRevision,
    schemaVersion: remote.schemaVersion ?? 1,
    activeSlot: remote.activeSlot,
    exportedAt: remote.exportedAt,
    manifest,
    legacyInference,
    snapshot,
    counts: {
      accounts: snapshot.accounts.filter((record) => !record.archivedAt).length,
      transactions: snapshot.transactions.filter((record) => !record.archivedAt).length,
      budgetCycles: snapshot.budgetCycles.filter((record) => !record.archivedAt).length,
      planInstances: snapshot.planInstances.filter((record) => !record.archivedAt).length,
      subscriptions: snapshot.subscriptions.filter((record) => !record.archivedAt).length
    },
    warnings,
    consistencyErrors,
    meaningfulRemoteData: hasMeaningfulProfileData(snapshot)
  };
}

export function prepareRemoteRestore({
  inspection,
  now,
  appVersion,
  deviceId,
  legacyChoice
}: {
  inspection: RemoteProfileInspection;
  now: string;
  appVersion: string;
  deviceId?: string;
  legacyChoice?: {
    lifecycle: RemoteProfileLifecycle;
    onboardingStep?: ManifestOnboardingStep;
  };
}): PreparedRemoteRestore {
  if (inspection.consistencyErrors.length > 0) {
    throw new Error(inspection.consistencyErrors.join(" "));
  }

  const manifest =
    inspection.manifest ??
    createProfileManifest({
      now,
      appVersion,
      deviceId,
      lifecycle: legacyChoice?.lifecycle ?? inspection.legacyInference?.lifecycle ?? "setup",
      onboardingStep: legacyChoice?.onboardingStep ?? inspection.legacyInference?.onboardingStep ?? "accounts"
    });
  const descriptor = createConnectionDescriptor(inspection.spreadsheetId, {
    profileId: manifest.profileId,
    lastKnownRemoteRevision: inspection.remoteRevision,
    lastSuccessfulSyncAt: now
  });
  const settings = upsertSetting(upsertProfileManifest(inspection.snapshot.settings, manifest), "googleConnection", JSON.stringify(descriptor));
  const syncState: SyncState = {
    key: "google",
    status: "synced",
    spreadsheetId: inspection.spreadsheetId,
    profileId: manifest.profileId,
    remoteRevision: inspection.remoteRevision,
    lastSyncedAt: now,
    lastRemoteWriterDeviceId: manifest.lastWrittenByDeviceId,
    message: "Remote profile restored to this device."
  };
  const snapshot: BluehourSnapshot = {
    ...inspection.snapshot,
    settings,
    outboxOperations: [],
    conflicts: [],
    syncState: [syncState]
  };

  return {
    snapshot,
    manifest,
    shell: shellStateFromManifest(manifest)
  };
}

export function completeSnapshot(snapshot: Partial<BluehourSnapshot>): BluehourSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    ...snapshot,
    accounts: snapshot.accounts ?? [],
    balanceSnapshots: snapshot.balanceSnapshots ?? [],
    transactions: snapshot.transactions ?? [],
    transactionLegs: snapshot.transactionLegs ?? [],
    transactionSplits: snapshot.transactionSplits ?? [],
    categories: snapshot.categories ?? [],
    budgetCycles: snapshot.budgetCycles ?? [],
    budgetAllocations: snapshot.budgetAllocations ?? [],
    budgetTransfers: snapshot.budgetTransfers ?? [],
    recurringRules: snapshot.recurringRules ?? [],
    planInstances: snapshot.planInstances ?? [],
    subscriptions: snapshot.subscriptions ?? [],
    extraIncomeAllocations: snapshot.extraIncomeAllocations ?? [],
    savingsGoals: snapshot.savingsGoals ?? [],
    savingsGoalContributions: snapshot.savingsGoalContributions ?? [],
    coachInsightDecisions: snapshot.coachInsightDecisions ?? [],
    purchaseChecks: snapshot.purchaseChecks ?? [],
    categorisationRules: snapshot.categorisationRules ?? [],
    importProfiles: snapshot.importProfiles ?? [],
    importBatches: snapshot.importBatches ?? [],
    importRowAudits: snapshot.importRowAudits ?? [],
    reconciliations: snapshot.reconciliations ?? [],
    reviewSessions: snapshot.reviewSessions ?? [],
    settings: snapshot.settings ?? [],
    outboxOperations: snapshot.outboxOperations ?? [],
    conflicts: snapshot.conflicts ?? [],
    syncState: snapshot.syncState ?? []
  };
}

function upsertProfileManifest(settings: readonly AppSettings[], manifest: BluehourProfileManifest): AppSettings[] {
  const record = profileManifestSettingRecord(settings, manifest);
  return upsertSettingsRecord(settings, record);
}

function readRemoteProfileManifest(settings: readonly AppSettings[]): BluehourProfileManifest | null {
  try {
    return readProfileManifest(settings);
  } catch (caught) {
    throw new Error(`Remote profile manifest failed validation: ${caught instanceof Error ? caught.message : "invalid manifest"}`, { cause: caught });
  }
}

function upsertSetting(settings: readonly AppSettings[], key: AppSettings["key"], valueJson: string): AppSettings[] {
  const existing = settings.find((setting) => setting.key === key && !setting.archivedAt);
  const record: AppSettings = existing
    ? {
        ...touchRecord(existing),
        valueJson
      }
    : {
        ...createRecordMeta("settings"),
        key,
        valueJson
      };
  return upsertSettingsRecord(settings, record);
}

function upsertSettingsRecord(settings: readonly AppSettings[], record: AppSettings): AppSettings[] {
  const next = settings.filter((setting) => setting.id !== record.id);
  next.push(record);
  return next;
}

function validateSpreadsheetId(spreadsheetId: string): void {
  if (!/^[a-zA-Z0-9-_]{8,}$/.test(spreadsheetId)) {
    throw new Error("Enter a valid Google Sheet URL or spreadsheet ID.");
  }
}

function resemblesBluehourSheet(titles: readonly string[]): boolean {
  const titleSet = new Set(titles);
  return titleSet.has("Meta") && (titleSet.has("A_Accounts") || titleSet.has("Accounts"));
}

function containsDemoIdentifiers(snapshot: Pick<BluehourSnapshot, "accounts" | "transactions" | "settings">): boolean {
  const haystack = [
    ...snapshot.accounts.map((account) => `${account.id} ${account.name}`),
    ...snapshot.transactions.map((transaction) => `${transaction.id} ${transaction.description}`),
    ...snapshot.settings.map((setting) => `${setting.id} ${setting.valueJson}`)
  ].join(" ");
  return /meranti|Vista Heights|Banyan Market|fictional|demo/i.test(haystack);
}
