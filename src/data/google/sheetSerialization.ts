import type { BluehourSnapshot } from "../../domain/types";
import { readProfileManifest } from "../../domain/profileManifest";
import { syncedStoreSchemas } from "../local-db/validators";
import {
  BLUEHOUR_SCHEMA_VERSION,
  GOOGLE_DOMAIN_TABS,
  GOOGLE_SHEET_SLOTS,
  clearSheetValues,
  readSheetRanges,
  writeRawSheetValues,
  type GoogleSheetSlot
} from "./googleSheetsAdapter";

export type SheetPayload = Record<string, unknown[][]>;

export interface RemoteSheetSnapshot {
  snapshot: Partial<BluehourSnapshot>;
  remoteRevision: number;
  schemaVersion?: number;
  activeSlot?: GoogleSheetSlot;
  exportedAt?: string;
  committedAt?: string;
  lastWrittenByDeviceId?: string;
}

export class RemoteRevisionChangedError extends Error {
  constructor(
    readonly expectedRemoteRevision: number,
    readonly actualRemoteRevision: number
  ) {
    super(`remote_revision_changed: expected remote revision ${expectedRemoteRevision}, found ${actualRemoteRevision}`);
    this.name = "RemoteRevisionChangedError";
  }
}

const STORE_BY_TAB = {
  Accounts: "accounts",
  BalanceSnapshots: "balanceSnapshots",
  Transactions: "transactions",
  TransactionLegs: "transactionLegs",
  TransactionSplits: "transactionSplits",
  Categories: "categories",
  BudgetCycles: "budgetCycles",
  BudgetAllocations: "budgetAllocations",
  BudgetTransfers: "budgetTransfers",
  RecurringRules: "recurringRules",
  PlanInstances: "planInstances",
  Subscriptions: "subscriptions",
  ExtraIncomeAllocations: "extraIncomeAllocations",
  SavingsGoals: "savingsGoals",
  SavingsGoalContributions: "savingsGoalContributions",
  CoachInsightDecisions: "coachInsightDecisions",
  PurchaseChecks: "purchaseChecks",
  CategorisationRules: "categorisationRules",
  ImportProfiles: "importProfiles",
  ImportBatches: "importBatches",
  ImportRowAudits: "importRowAudits",
  Reconciliations: "reconciliations",
  ReviewSessions: "reviewSessions",
  Settings: "settings"
} as const satisfies Record<(typeof GOOGLE_DOMAIN_TABS)[number], keyof BluehourSnapshot>;

const JSON_STRING_COLUMNS = new Set([
  "candidateScoresJson",
  "candidateTransactionIdsJson",
  "columnMappingJson",
  "itemsJson",
  "localJson",
  "matchReasonsJson",
  "priceHistoryJson",
  "remoteJson",
  "signRulesJson",
  "valueJson"
]);

export function serializeSnapshotToSheets(snapshot: BluehourSnapshot, remoteRevision = currentRemoteRevision(snapshot) + 1): SheetPayload {
  return {
    Meta: metaRows({ remoteRevision, schemaVersion: BLUEHOUR_SCHEMA_VERSION, lastWrittenByDeviceId: lastWrittenByDeviceId(snapshot) }),
    ...domainRows(snapshot)
  };
}

export function serializeSnapshotToSlot(
  snapshot: BluehourSnapshot,
  slot: GoogleSheetSlot
): SheetPayload {
  return Object.fromEntries(
    Object.entries(domainRows(snapshot)).map(([tabName, values]) => [`${slot}_${tabName}`, values])
  );
}

export async function pushSnapshotToGoogleSheet(
  spreadsheetId: string,
  snapshot: BluehourSnapshot,
  accessToken: string,
  fetcher: typeof fetch = fetch,
  remoteRevision = currentRemoteRevision(snapshot) + 1,
  expectedRemoteRevision?: number
): Promise<void> {
  const currentMetaPayload = await readSheetRanges(spreadsheetId, ["Meta!A1:ZZZ"], accessToken, fetcher);
  const currentMeta = keyValueRows(currentMetaPayload.Meta ?? []);
  const actualRemoteRevision = numberFromUnknown(currentMeta.remoteRevision) ?? 0;
  if (expectedRemoteRevision !== undefined && actualRemoteRevision !== expectedRemoteRevision) {
    throw new RemoteRevisionChangedError(expectedRemoteRevision, actualRemoteRevision);
  }
  const activeSlot = parseSlot(currentMeta.activeSlot) ?? "A";
  const inactiveSlot = activeSlot === "A" ? "B" : "A";
  const payload = serializeSnapshotToSlot(snapshot, inactiveSlot);

  for (const [tabName, values] of Object.entries(payload)) {
    await clearSheetValues(spreadsheetId, `${tabName}!A1:ZZZ`, accessToken, fetcher);
    await writeRawSheetValues(spreadsheetId, `${tabName}!A1`, values, accessToken, fetcher);
  }

  const inactiveRanges = GOOGLE_DOMAIN_TABS.map((tab) => `${inactiveSlot}_${tab}!A1:ZZZ`);
  const readBack = await readSheetRanges(spreadsheetId, inactiveRanges, accessToken, fetcher);
  assertReadBackMatchesSnapshot(snapshot, inactiveSlot, readBack);

  await writeRawSheetValues(
    spreadsheetId,
    "Meta!A1",
    metaRows({
      activeSlot: inactiveSlot,
      remoteRevision,
      schemaVersion: BLUEHOUR_SCHEMA_VERSION,
      committedAt: new Date().toISOString(),
      lastWrittenByDeviceId: lastWrittenByDeviceId(snapshot)
    }),
    accessToken,
    fetcher
  );
}

export async function readSnapshotFromGoogleSheet(
  spreadsheetId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<RemoteSheetSnapshot> {
  const metaPayload = await readSheetRanges(spreadsheetId, ["Meta!A1:ZZZ"], accessToken, fetcher);
  const meta = keyValueRows(metaPayload.Meta ?? []);
  const activeSlot = parseSlot(meta.activeSlot);

  if (!activeSlot) {
    const legacyRanges = ["Meta", ...GOOGLE_DOMAIN_TABS].map((tab) => `${tab}!A1:ZZZ`);
    const legacyPayload = await readSheetRanges(spreadsheetId, legacyRanges, accessToken, fetcher);
    return deserializeSnapshotFromSheets(legacyPayload);
  }

  const ranges = GOOGLE_DOMAIN_TABS.map((tab) => `${activeSlot}_${tab}!A1:ZZZ`);
  const slotPayload = await readSheetRanges(spreadsheetId, ranges, accessToken, fetcher);
  const normalisedPayload = normaliseSlotPayload(slotPayload, activeSlot);
  return deserializeSnapshotFromSheets({
    Meta: metaPayload.Meta ?? [],
    ...normalisedPayload
  });
}

export function deserializeSnapshotFromSheets(payload: SheetPayload): RemoteSheetSnapshot {
  const meta = keyValueRows(payload.Meta ?? []);
  const activeSlot = parseSlot(meta.activeSlot);
  const snapshot = {} as Partial<BluehourSnapshot>;

  for (const tab of GOOGLE_DOMAIN_TABS) {
    const storeName = STORE_BY_TAB[tab];
    const records = rowsToRecords(payload[tab]);
    validateSheetRecords(tab, storeName, records);
    Object.assign(snapshot, { [storeName]: records });
  }

  return {
    remoteRevision: numberFromUnknown(meta.remoteRevision) ?? 0,
    schemaVersion: numberFromUnknown(meta.schemaVersion) ?? 1,
    activeSlot,
    exportedAt: typeof meta.exportedAt === "string" ? meta.exportedAt : typeof meta.committedAt === "string" ? meta.committedAt : undefined,
    committedAt: typeof meta.committedAt === "string" ? meta.committedAt : undefined,
    lastWrittenByDeviceId: typeof meta.lastWrittenByDeviceId === "string" ? meta.lastWrittenByDeviceId : undefined,
    snapshot
  };
}

export function currentRemoteRevision(snapshot: BluehourSnapshot): number {
  return snapshot.syncState.find((state) => state.key === "google")?.remoteRevision ?? 0;
}

function domainRows(snapshot: BluehourSnapshot): SheetPayload {
  return Object.fromEntries(
    GOOGLE_DOMAIN_TABS.map((tab) => [tab, rowsFor(snapshot[STORE_BY_TAB[tab]] as readonly object[])])
  );
}

function metaRows({
  activeSlot,
  remoteRevision,
  schemaVersion,
  committedAt,
  lastWrittenByDeviceId
}: {
  activeSlot?: GoogleSheetSlot;
  remoteRevision: number;
  schemaVersion: number;
  committedAt?: string;
  lastWrittenByDeviceId?: string;
}): unknown[][] {
  const rows: unknown[][] = [
    ["key", "value"],
    ["schemaVersion", schemaVersion],
    ["remoteRevision", remoteRevision],
    ["exportedAt", committedAt ?? new Date().toISOString()]
  ];

  if (activeSlot) {
    rows.push(["activeSlot", activeSlot], ["committedAt", committedAt]);
  }

  if (lastWrittenByDeviceId) {
    rows.push(["lastWrittenByDeviceId", lastWrittenByDeviceId]);
  }

  return rows;
}

function lastWrittenByDeviceId(snapshot: BluehourSnapshot): string | undefined {
  try {
    return readProfileManifest(snapshot.settings)?.lastWrittenByDeviceId;
  } catch {
    return undefined;
  }
}

function rowsFor(records: readonly object[]): unknown[][] {
  const keys = new Set<string>();
  records.forEach((record) => {
    Object.keys(record).forEach((key) => keys.add(key));
  });
  const headers = [...keys].sort();

  if (headers.length === 0) {
    return [["id"]];
  }

  return [
    headers,
    ...records.map((record) => {
      const row = record as Record<string, unknown>;
      return headers.map((header) => valueForSheet(row[header]));
    })
  ];
}

function valueForSheet(value: unknown): unknown {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function keyValueRows(rows: unknown[][]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  rows.slice(1).forEach((row) => {
    const key = String(row[0] ?? "");
    if (key) {
      result[key] = inferValue(row[1]);
    }
  });
  return result;
}

function rowsToRecords<T extends object>(rows: unknown[][] | undefined): T[] {
  if (!rows || rows.length <= 1) {
    return [];
  }

  const headers = rows[0].map((header) => String(header));
  return rows.slice(1).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const value = inferCellValue(header, row[index]);
      if (value !== undefined) {
        record[header] = value;
      }
    });
    return record as T;
  });
}

function inferCellValue(header: string, value: unknown): unknown {
  if (!JSON_STRING_COLUMNS.has(header)) {
    return inferValue(value);
  }

  if (value === "" || value === undefined) {
    return undefined;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function inferValue(value: unknown): unknown {
  if (value === "" || value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function parseSlot(value: unknown): GoogleSheetSlot | undefined {
  return GOOGLE_SHEET_SLOTS.includes(value as GoogleSheetSlot) ? (value as GoogleSheetSlot) : undefined;
}

function normaliseSlotPayload(payload: SheetPayload, slot: GoogleSheetSlot): SheetPayload {
  return Object.fromEntries(
    GOOGLE_DOMAIN_TABS.map((tab) => [tab, payload[`${slot}_${tab}`] ?? []])
  );
}

function assertReadBackMatchesSnapshot(snapshot: BluehourSnapshot, slot: GoogleSheetSlot, readBack: SheetPayload): void {
  const normalised = normaliseSlotPayload(readBack, slot);
  const expectedPayload = domainRows(snapshot);
  for (const tab of GOOGLE_DOMAIN_TABS) {
    const storeName = STORE_BY_TAB[tab];
    const expectedRecords = rowsToRecords(expectedPayload[tab]);
    const actualRecords = rowsToRecords(normalised[tab]);
    validateSheetRecords(tab, storeName, actualRecords);
    if (stableJson(actualRecords) !== stableJson(expectedRecords)) {
      throw new Error(`Google staged write verification failed for ${tab}`);
    }
  }
}

function validateSheetRecords(tab: string, storeName: keyof typeof syncedStoreSchemas, records: readonly object[]): void {
  const schema = syncedStoreSchemas[storeName];
  records.forEach((record, index) => {
    try {
      schema.parse(record);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "invalid record";
      throw new Error(`Google Sheet ${tab} row ${index + 2} failed schema validation: ${detail}`, { cause: caught });
    }
  });
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
