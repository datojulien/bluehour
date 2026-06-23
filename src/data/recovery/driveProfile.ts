import { createRecordMeta, touchRecord } from "../../domain/records";
import type { AppSettings, BluehourSnapshot, SyncState } from "../../domain/types";
import {
  createProfileManifest,
  hasMeaningfulProfileData,
  nextManifestForCheckpoint,
  profileManifestSettingRecord,
  readProfileManifest,
  shellStateFromManifest,
  type BluehourProfileManifest
} from "../../domain/profileManifest";
import { inspectProfileHealth, liveManifestRepairRecord, type ProfileHealthResult } from "../../domain/profileHealth";
import {
  DRIVE_VAULT_SCHEMA_VERSION,
  createDriveConnectionDescriptor,
  type DriveConnectionDescriptor,
  type DriveVaultFiles,
  type RemoteDriveVaultSnapshot
} from "../google/driveAppDataVault";
import type { GoogleAccountProfile } from "../google/googleAuth";
import { completeSnapshot, type PreparedRemoteRestore, type RemoteProfileCounts } from "./remoteProfile";

export interface DriveProfileInspection {
  files: DriveVaultFiles;
  account: GoogleAccountProfile;
  remoteRevision: number;
  schemaVersion: number;
  activeSlot?: "A" | "B";
  exportedAt?: string;
  manifest: BluehourProfileManifest | null;
  snapshot: BluehourSnapshot;
  counts: RemoteProfileCounts;
  warnings: string[];
  consistencyErrors: string[];
  profileHealth: ProfileHealthResult;
  meaningfulRemoteData: boolean;
  vaultExists: boolean;
  lastWrittenByDeviceId?: string;
}

export function inspectDriveVaultProfile(
  files: DriveVaultFiles,
  account: GoogleAccountProfile,
  remote: RemoteDriveVaultSnapshot | null
): DriveProfileInspection {
  if (!remote) {
    const snapshot = completeSnapshot({});
    return {
      files,
      account,
      remoteRevision: 0,
      schemaVersion: DRIVE_VAULT_SCHEMA_VERSION,
      snapshot,
      manifest: null,
      counts: emptyCounts(),
      warnings: ["No Bluehour Drive vault exists yet for this Google account."],
      consistencyErrors: [],
      profileHealth: inspectProfileHealth({
        snapshot,
        manifest: null,
        remoteSchemaVersion: DRIVE_VAULT_SCHEMA_VERSION,
        supportedRemoteSchemaVersion: DRIVE_VAULT_SCHEMA_VERSION
      }),
      meaningfulRemoteData: false,
      vaultExists: false
    };
  }

  const snapshot = completeSnapshot(remote.snapshot);
  const warnings: string[] = [];

  if ((remote.schemaVersion ?? 1) > DRIVE_VAULT_SCHEMA_VERSION) {
    warnings.push(`Google Drive vault schema ${remote.schemaVersion} is newer than this Bluehour build supports. Open read-only recovery before writing.`);
  }

  const manifest = readRemoteProfileManifest(snapshot.settings);
  if (!manifest && remote.remoteRevision > 0) {
    warnings.push("This Drive vault is missing a profile manifest. Restore is blocked until the profile can be inspected safely.");
  }

  if (!hasMeaningfulProfileData(snapshot)) {
    warnings.push("This Drive vault does not yet contain a committed Bluehour profile.");
  }

  if (containsDemoIdentifiers(snapshot)) {
    warnings.push("Remote data contains fictional demonstration identifiers. Confirm before restoring it into the live profile.");
  }

  const profileHealth = inspectProfileHealth({
    snapshot,
    manifest,
    remoteSchemaVersion: remote.schemaVersion ?? 1,
    supportedRemoteSchemaVersion: DRIVE_VAULT_SCHEMA_VERSION
  });
  warnings.push(...profileHealth.issues.filter((issue) => issue.severity !== "danger").map((issue) => issue.title));
  const consistencyErrors = profileHealth.issues
    .filter((issue) => issue.severity === "danger" || (issue.id === "manifest_missing" && !profileHealth.canResumeAsLive && remote.remoteRevision > 0))
    .map((issue) => issue.explanation.join(" "));

  return {
    files,
    account,
    remoteRevision: remote.remoteRevision,
    schemaVersion: remote.schemaVersion ?? 1,
    activeSlot: remote.activeSlot,
    exportedAt: remote.exportedAt,
    manifest,
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
    profileHealth,
    meaningfulRemoteData: hasMeaningfulProfileData(snapshot),
    vaultExists: true,
    lastWrittenByDeviceId: remote.lastWrittenByDeviceId
  };
}

export function prepareDriveVaultRestore({
  inspection,
  now,
  appVersion,
  deviceId,
  repairAsLive = false
}: {
  inspection: DriveProfileInspection;
  now: string;
  appVersion: string;
  deviceId?: string;
  repairAsLive?: boolean;
}): PreparedRemoteRestore {
  if (inspection.consistencyErrors.length > 0) {
    throw new Error(inspection.consistencyErrors.join(" "));
  }

  if (repairAsLive && !inspection.profileHealth.canResumeAsLive) {
    throw new Error("This Google Drive vault cannot be safely repaired as live.");
  }

  const manifest = repairAsLive
    ? readProfileManifest([
        liveManifestRepairRecord({
          settings: inspection.snapshot.settings,
          manifest: inspection.manifest,
          now,
          appVersion,
          deviceId
        })
      ])
    : inspection.manifest ??
      createProfileManifest({
        now,
        appVersion,
        deviceId,
        lifecycle: "setup",
        onboardingStep: "preferences"
      });
  if (!manifest) {
    throw new Error("Profile manifest could not be prepared for restore.");
  }
  const descriptor = driveDescriptorForInspection(inspection, manifest, now);
  const settings = upsertSetting(upsertProfileManifest(inspection.snapshot.settings, manifest), "googleConnection", JSON.stringify(descriptor));
  const syncState: SyncState = {
    key: "google",
    provider: "drive_appdata",
    status: "synced",
    driveManifestFileId: inspection.files.manifestFileId,
    driveSlotAFileId: inspection.files.slotAFileId,
    driveSlotBFileId: inspection.files.slotBFileId,
    googleSubject: inspection.account.sub,
    googleEmail: inspection.account.email,
    googleName: inspection.account.name,
    profileId: manifest.profileId,
    remoteRevision: inspection.remoteRevision,
    lastSyncedAt: now,
    lastRemoteWriterDeviceId: inspection.lastWrittenByDeviceId,
    message: inspection.vaultExists ? "Google Drive vault restored to this device." : "Google Drive vault connected to this device."
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

export function prepareDriveVaultReadOnlyRestore({
  inspection,
  now,
  appVersion,
  deviceId
}: {
  inspection: DriveProfileInspection;
  now: string;
  appVersion: string;
  deviceId?: string;
}): PreparedRemoteRestore {
  const manifest = inspection.manifest
    ? nextManifestForCheckpoint({
        current: inspection.manifest,
        now,
        appVersion,
        deviceId,
        lifecycle: "read_only_recovery"
      })
    : createProfileManifest({
        now,
        appVersion,
        deviceId,
        lifecycle: "read_only_recovery"
      });
  const descriptor = driveDescriptorForInspection(inspection, manifest, now);
  const settings = upsertSetting(upsertProfileManifest(inspection.snapshot.settings, manifest), "googleConnection", JSON.stringify(descriptor));
  const snapshot: BluehourSnapshot = {
    ...inspection.snapshot,
    settings,
    outboxOperations: [],
    conflicts: [],
    syncState: [
      {
        key: "google",
        provider: "drive_appdata",
        status: "read_only_recovery",
        driveManifestFileId: inspection.files.manifestFileId,
        driveSlotAFileId: inspection.files.slotAFileId,
        driveSlotBFileId: inspection.files.slotBFileId,
        googleSubject: inspection.account.sub,
        googleEmail: inspection.account.email,
        googleName: inspection.account.name,
        profileId: manifest.profileId,
        remoteRevision: inspection.remoteRevision,
        lastSyncedAt: now,
        lastRemoteWriterDeviceId: inspection.lastWrittenByDeviceId,
        message:
          inspection.consistencyErrors.length > 0
            ? `Google Drive vault restored read-only: ${inspection.consistencyErrors.join(" ")}`
            : "Google Drive vault restored read-only for manual inspection."
      }
    ]
  };

  return {
    snapshot,
    manifest,
    shell: shellStateFromManifest(manifest)
  };
}

export function driveDescriptorForInspection(
  inspection: DriveProfileInspection,
  manifest: BluehourProfileManifest,
  lastSuccessfulSyncAt?: string
): DriveConnectionDescriptor {
  return createDriveConnectionDescriptor(inspection.files, {
    profileId: manifest.profileId,
    googleSubject: inspection.account.sub,
    googleEmail: inspection.account.email,
    googleName: inspection.account.name,
    lastKnownRemoteRevision: inspection.remoteRevision,
    lastSuccessfulSyncAt
  });
}

function emptyCounts(): RemoteProfileCounts {
  return {
    accounts: 0,
    transactions: 0,
    budgetCycles: 0,
    planInstances: 0,
    subscriptions: 0
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

function containsDemoIdentifiers(snapshot: Pick<BluehourSnapshot, "accounts" | "transactions" | "settings">): boolean {
  const haystack = [
    ...snapshot.accounts.map((account) => `${account.id} ${account.name}`),
    ...snapshot.transactions.map((transaction) => `${transaction.id} ${transaction.description}`),
    ...snapshot.settings.map((setting) => `${setting.id} ${setting.valueJson}`)
  ].join(" ");
  return /meranti|Vista Heights|Banyan Market|fictional|demo/i.test(haystack);
}
