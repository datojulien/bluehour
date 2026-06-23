import { z } from "zod";
import { readProfileManifest } from "../../domain/profileManifest";
import type { BluehourSnapshot, SyncState } from "../../domain/types";
import { syncedStoreSchemas } from "../local-db/validators";
import { currentRemoteRevision, SYNCED_STORES, type RemoteSnapshotForSync } from "../sync/remoteSync";

export const DRIVE_VAULT_SCHEMA_VERSION = 2;
export const DRIVE_VAULT_MANIFEST_NAME = "bluehour-manifest.json";
export const DRIVE_VAULT_SLOT_A_NAME = "bluehour-slot-A.json";
export const DRIVE_VAULT_SLOT_B_NAME = "bluehour-slot-B.json";

export type DriveVaultSlot = "A" | "B";

export interface DriveVaultFiles {
  manifestFileId: string;
  slotAFileId: string;
  slotBFileId: string;
}

export interface DriveVaultManifest {
  kind: "bluehour-drive-vault-manifest";
  schemaVersion: number;
  remoteRevision: number;
  activeSlot: DriveVaultSlot;
  profileId?: string;
  appVersion?: string;
  committedAt?: string;
  lastWrittenByDeviceId?: string;
  files: DriveVaultFiles;
}

interface DriveVaultSlotEnvelope {
  kind: "bluehour-drive-vault-slot";
  schemaVersion: number;
  remoteRevision: number;
  profileId?: string;
  exportedAt: string;
  appVersion: string;
  lastWrittenByDeviceId?: string;
  snapshot: Partial<BluehourSnapshot>;
}

export interface RemoteDriveVaultSnapshot extends RemoteSnapshotForSync {
  manifest: DriveVaultManifest;
  activeSlot: DriveVaultSlot;
  exportedAt?: string;
}

export interface DriveConnectionDescriptor {
  provider: "drive_appdata";
  vaultSchemaVersion: number;
  profileId: string;
  driveManifestFileId: string;
  driveSlotAFileId: string;
  driveSlotBFileId: string;
  googleSubject?: string;
  googleEmail?: string;
  googleName?: string;
  lastKnownRemoteRevision: number;
  lastSuccessfulSyncAt?: string;
}

interface GoogleDriveFileBody {
  id?: unknown;
  name?: unknown;
  modifiedTime?: unknown;
}

const slotEnvelopeSchema = z.object({
  kind: z.literal("bluehour-drive-vault-slot"),
  schemaVersion: z.number().int().positive(),
  remoteRevision: z.number().int().nonnegative(),
  profileId: z.string().optional(),
  exportedAt: z.string().min(1),
  appVersion: z.string().min(1),
  lastWrittenByDeviceId: z.string().optional(),
  snapshot: z.record(z.string(), z.unknown())
});

const manifestSchema = z.object({
  kind: z.literal("bluehour-drive-vault-manifest"),
  schemaVersion: z.number().int().positive(),
  remoteRevision: z.number().int().nonnegative(),
  activeSlot: z.enum(["A", "B"]),
  profileId: z.string().optional(),
  appVersion: z.string().optional(),
  committedAt: z.string().optional(),
  lastWrittenByDeviceId: z.string().optional(),
  files: z.object({
    manifestFileId: z.string().min(1),
    slotAFileId: z.string().min(1),
    slotBFileId: z.string().min(1)
  })
});

const driveConnectionDescriptorSchema = z.object({
  provider: z.literal("drive_appdata"),
  vaultSchemaVersion: z.number().int().positive(),
  profileId: z.string().min(1),
  driveManifestFileId: z.string().min(1),
  driveSlotAFileId: z.string().min(1),
  driveSlotBFileId: z.string().min(1),
  googleSubject: z.string().optional(),
  googleEmail: z.string().optional(),
  googleName: z.string().optional(),
  lastKnownRemoteRevision: z.number().int().nonnegative(),
  lastSuccessfulSyncAt: z.string().optional()
});

export class RemoteRevisionChangedError extends Error {
  constructor(
    readonly expectedRemoteRevision: number,
    readonly actualRemoteRevision: number
  ) {
    super(`remote_revision_changed: expected remote revision ${expectedRemoteRevision}, found ${actualRemoteRevision}`);
    this.name = "RemoteRevisionChangedError";
  }
}

export function createDriveConnectionDescriptor(
  files: DriveVaultFiles,
  {
    profileId,
    googleSubject,
    googleEmail,
    googleName,
    lastKnownRemoteRevision = 0,
    lastSuccessfulSyncAt
  }: {
    profileId: string;
    googleSubject?: string;
    googleEmail?: string;
    googleName?: string;
    lastKnownRemoteRevision?: number;
    lastSuccessfulSyncAt?: string;
  }
): DriveConnectionDescriptor {
  return {
    provider: "drive_appdata",
    vaultSchemaVersion: DRIVE_VAULT_SCHEMA_VERSION,
    profileId,
    driveManifestFileId: files.manifestFileId,
    driveSlotAFileId: files.slotAFileId,
    driveSlotBFileId: files.slotBFileId,
    googleSubject,
    googleEmail,
    googleName,
    lastKnownRemoteRevision,
    lastSuccessfulSyncAt
  };
}

export function parseDriveConnectionDescriptor(value: unknown): DriveConnectionDescriptor {
  return driveConnectionDescriptorSchema.parse(value);
}

export function driveVaultFilesFromDescriptor(descriptor: Pick<DriveConnectionDescriptor, "driveManifestFileId" | "driveSlotAFileId" | "driveSlotBFileId">): DriveVaultFiles {
  return {
    manifestFileId: descriptor.driveManifestFileId,
    slotAFileId: descriptor.driveSlotAFileId,
    slotBFileId: descriptor.driveSlotBFileId
  };
}

export function driveVaultFilesFromSyncState(syncState: SyncState | undefined): DriveVaultFiles | null {
  if (!syncState?.driveManifestFileId || !syncState.driveSlotAFileId || !syncState.driveSlotBFileId) {
    return null;
  }

  return {
    manifestFileId: syncState.driveManifestFileId,
    slotAFileId: syncState.driveSlotAFileId,
    slotBFileId: syncState.driveSlotBFileId
  };
}

export async function ensureDriveVaultFiles(accessToken: string, fetcher: typeof fetch = fetch): Promise<DriveVaultFiles> {
  const [manifestFileId, slotAFileId, slotBFileId] = await Promise.all([
    findOrCreateAppDataFile(DRIVE_VAULT_MANIFEST_NAME, accessToken, fetcher),
    findOrCreateAppDataFile(DRIVE_VAULT_SLOT_A_NAME, accessToken, fetcher),
    findOrCreateAppDataFile(DRIVE_VAULT_SLOT_B_NAME, accessToken, fetcher)
  ]);

  return {
    manifestFileId,
    slotAFileId,
    slotBFileId
  };
}

export async function readDriveVaultManifest(files: DriveVaultFiles, accessToken: string, fetcher: typeof fetch = fetch): Promise<DriveVaultManifest | null> {
  try {
    const body = await readJsonFile(files.manifestFileId, accessToken, fetcher);
    return manifestSchema.parse(body);
  } catch (caught) {
    if (caught instanceof SyntaxError || caught instanceof z.ZodError || isGoogleNotFound(caught)) {
      return null;
    }
    throw caught;
  }
}

export async function readSnapshotFromDriveVault(
  files: DriveVaultFiles,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<RemoteDriveVaultSnapshot | null> {
  const manifest = await readDriveVaultManifest(files, accessToken, fetcher);
  if (!manifest) {
    return null;
  }

  if (manifest.schemaVersion > DRIVE_VAULT_SCHEMA_VERSION) {
    return {
      manifest,
      activeSlot: manifest.activeSlot,
      schemaVersion: manifest.schemaVersion,
      remoteRevision: manifest.remoteRevision,
      lastWrittenByDeviceId: manifest.lastWrittenByDeviceId,
      exportedAt: manifest.committedAt,
      snapshot: {}
    };
  }

  const slotFileId = manifest.activeSlot === "A" ? manifest.files.slotAFileId : manifest.files.slotBFileId;
  const envelope = parseSlotEnvelope(await readJsonFile(slotFileId, accessToken, fetcher));

  if (envelope.schemaVersion > DRIVE_VAULT_SCHEMA_VERSION) {
    return {
      manifest,
      activeSlot: manifest.activeSlot,
      schemaVersion: envelope.schemaVersion,
      remoteRevision: envelope.remoteRevision,
      lastWrittenByDeviceId: envelope.lastWrittenByDeviceId,
      exportedAt: envelope.exportedAt,
      snapshot: {}
    };
  }

  validateSyncedSnapshot(envelope.snapshot);
  return {
    manifest,
    activeSlot: manifest.activeSlot,
    schemaVersion: envelope.schemaVersion,
    remoteRevision: envelope.remoteRevision,
    lastWrittenByDeviceId: envelope.lastWrittenByDeviceId,
    exportedAt: envelope.exportedAt,
    snapshot: envelope.snapshot
  };
}

export async function pushSnapshotToDriveVault(
  files: DriveVaultFiles,
  snapshot: BluehourSnapshot,
  accessToken: string,
  fetcher: typeof fetch = fetch,
  remoteRevision = currentRemoteRevision(snapshot) + 1,
  expectedRemoteRevision?: number
): Promise<DriveVaultManifest> {
  const currentManifest = await readDriveVaultManifest(files, accessToken, fetcher);
  const actualRemoteRevision = currentManifest?.remoteRevision ?? 0;
  if (expectedRemoteRevision !== undefined && actualRemoteRevision !== expectedRemoteRevision) {
    throw new RemoteRevisionChangedError(expectedRemoteRevision, actualRemoteRevision);
  }

  const activeSlot = currentManifest?.activeSlot ?? "A";
  const inactiveSlot: DriveVaultSlot = activeSlot === "A" ? "B" : "A";
  const inactiveFileId = inactiveSlot === "A" ? files.slotAFileId : files.slotBFileId;
  const now = new Date().toISOString();
  const manifest = readProfileManifest(snapshot.settings);
  const envelope: DriveVaultSlotEnvelope = {
    kind: "bluehour-drive-vault-slot",
    schemaVersion: DRIVE_VAULT_SCHEMA_VERSION,
    remoteRevision,
    profileId: manifest?.profileId,
    exportedAt: now,
    appVersion: __BLUEHOUR_VERSION__,
    lastWrittenByDeviceId: manifest?.lastWrittenByDeviceId,
    snapshot: snapshotForRemoteVault(snapshot)
  };

  await writeJsonFile(inactiveFileId, envelope, accessToken, fetcher);
  const readBack = parseSlotEnvelope(await readJsonFile(inactiveFileId, accessToken, fetcher));
  validateSyncedSnapshot(readBack.snapshot);
  assertStableEqual(envelope.snapshot, readBack.snapshot, "Drive vault inactive-slot read-back did not match the local snapshot");

  const nextManifest: DriveVaultManifest = {
    kind: "bluehour-drive-vault-manifest",
    schemaVersion: DRIVE_VAULT_SCHEMA_VERSION,
    remoteRevision,
    activeSlot: inactiveSlot,
    profileId: manifest?.profileId,
    appVersion: __BLUEHOUR_VERSION__,
    committedAt: now,
    lastWrittenByDeviceId: manifest?.lastWrittenByDeviceId,
    files
  };
  await writeJsonFile(files.manifestFileId, nextManifest, accessToken, fetcher);
  return nextManifest;
}

export function snapshotForRemoteVault(snapshot: BluehourSnapshot): Partial<BluehourSnapshot> {
  return Object.fromEntries(SYNCED_STORES.map((storeName) => [storeName, snapshot[storeName]])) as Partial<BluehourSnapshot>;
}

async function findOrCreateAppDataFile(name: string, accessToken: string, fetcher: typeof fetch): Promise<string> {
  const existing = await findAppDataFile(name, accessToken, fetcher);
  if (existing) {
    return existing;
  }

  return createAppDataFile(name, accessToken, fetcher);
}

async function findAppDataFile(name: string, accessToken: string, fetcher: typeof fetch): Promise<string | null> {
  const search = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${escapeDriveQueryValue(name)}' and trashed = false`,
    fields: "files(id,name,modifiedTime)",
    pageSize: "1"
  });
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${search.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await googleDriveFailureMessage(response, "Google Drive app data search"));
  }

  const body = (await response.json()) as { files?: GoogleDriveFileBody[] };
  const file = body.files?.find((candidate) => candidate.name === name && typeof candidate.id === "string");
  return typeof file?.id === "string" ? file.id : null;
}

async function createAppDataFile(name: string, accessToken: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      parents: ["appDataFolder"],
      mimeType: "application/json"
    })
  });

  if (!response.ok) {
    throw new Error(await googleDriveFailureMessage(response, "Google Drive app data create"));
  }

  const body = (await response.json()) as GoogleDriveFileBody;
  if (typeof body.id !== "string") {
    throw new Error("Google Drive did not return an app data file ID");
  }

  return body.id;
}

async function readJsonFile(fileId: string, accessToken: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await googleDriveFailureMessage(response, "Google Drive app data read"));
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new SyntaxError("Google Drive app data file is empty");
  }

  return JSON.parse(text) as unknown;
}

async function writeJsonFile(fileId: string, value: unknown, accessToken: string, fetcher: typeof fetch): Promise<void> {
  const response = await fetcher(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });

  if (!response.ok) {
    throw new Error(await googleDriveFailureMessage(response, "Google Drive app data write"));
  }
}

function parseSlotEnvelope(value: unknown): DriveVaultSlotEnvelope {
  const parsed = slotEnvelopeSchema.parse(value);
  return {
    ...parsed,
    snapshot: parsed.snapshot as Partial<BluehourSnapshot>
  };
}

function validateSyncedSnapshot(snapshot: Partial<BluehourSnapshot>): void {
  for (const storeName of SYNCED_STORES) {
    const records = (snapshot[storeName] ?? []) as unknown[];
    records.forEach((record) => syncedStoreSchemas[storeName].parse(record));
  }
}

function assertStableEqual(left: unknown, right: unknown, message: string): void {
  if (stableJson(left) !== stableJson(right)) {
    throw new Error(message);
  }
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

async function googleDriveFailureMessage(response: Response, label: string): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string; error_description?: unknown; message?: unknown };
    if (typeof body.error === "string") {
      detail = body.error;
    } else if (typeof body.error?.message === "string") {
      detail = body.error.message;
    } else if (typeof body.error_description === "string") {
      detail = body.error_description;
    } else if (typeof body.message === "string") {
      detail = body.message;
    }
  } catch {
    detail = "";
  }

  return detail ? `${label} failed with ${response.status}: ${detail}` : `${label} failed with ${response.status}`;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isGoogleNotFound(error: unknown): boolean {
  return error instanceof Error && /failed with 404/.test(error.message);
}
