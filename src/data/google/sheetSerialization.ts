import type { BluehourSnapshot } from "../../domain/types";
import { BLUEHOUR_SCHEMA_VERSION, clearSheetValues, GOOGLE_SHEET_TABS, readSheetRanges, writeRawSheetValues } from "./googleSheetsAdapter";

export type SheetPayload = Record<string, unknown[][]>;

export interface RemoteSheetSnapshot {
  snapshot: Partial<BluehourSnapshot>;
  remoteRevision: number;
  exportedAt?: string;
}

export function serializeSnapshotToSheets(snapshot: BluehourSnapshot, remoteRevision = currentRemoteRevision(snapshot) + 1): SheetPayload {
  return {
    Meta: [
      ["key", "value"],
      ["schemaVersion", BLUEHOUR_SCHEMA_VERSION],
      ["remoteRevision", remoteRevision],
      ["exportedAt", new Date().toISOString()]
    ],
    Accounts: rowsFor(snapshot.accounts),
    BalanceSnapshots: rowsFor(snapshot.balanceSnapshots),
    Transactions: rowsFor(snapshot.transactions),
    TransactionLegs: rowsFor(snapshot.transactionLegs),
    TransactionSplits: rowsFor(snapshot.transactionSplits),
    Categories: rowsFor(snapshot.categories),
    BudgetCycles: rowsFor(snapshot.budgetCycles),
    BudgetAllocations: rowsFor(snapshot.budgetAllocations),
    BudgetTransfers: rowsFor(snapshot.budgetTransfers),
    RecurringRules: rowsFor(snapshot.recurringRules),
    PlanInstances: rowsFor(snapshot.planInstances),
    Subscriptions: rowsFor(snapshot.subscriptions),
    CategorisationRules: rowsFor(snapshot.categorisationRules),
    ImportProfiles: rowsFor(snapshot.importProfiles),
    ImportBatches: rowsFor(snapshot.importBatches),
    Reconciliations: rowsFor(snapshot.reconciliations),
    ReviewSessions: rowsFor(snapshot.reviewSessions),
    Settings: rowsFor(snapshot.settings)
  };
}

export async function pushSnapshotToGoogleSheet(
  spreadsheetId: string,
  snapshot: BluehourSnapshot,
  accessToken: string,
  fetcher: typeof fetch = fetch,
  remoteRevision = currentRemoteRevision(snapshot) + 1
): Promise<void> {
  const payload = serializeSnapshotToSheets(snapshot, remoteRevision);
  for (const [tabName, values] of Object.entries(payload)) {
    await clearSheetValues(spreadsheetId, `${tabName}!A1:ZZZ`, accessToken, fetcher);
    await writeRawSheetValues(spreadsheetId, `${tabName}!A1`, values, accessToken, fetcher);
  }
}

export async function readSnapshotFromGoogleSheet(
  spreadsheetId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<RemoteSheetSnapshot> {
  const ranges = GOOGLE_SHEET_TABS.map((tab) => `${tab}!A1:ZZZ`);
  const payload = await readSheetRanges(spreadsheetId, ranges, accessToken, fetcher);
  return deserializeSnapshotFromSheets(payload);
}

export function deserializeSnapshotFromSheets(payload: SheetPayload): RemoteSheetSnapshot {
  const meta = keyValueRows(payload.Meta ?? []);
  return {
    remoteRevision: numberFromUnknown(meta.remoteRevision) ?? 0,
    exportedAt: typeof meta.exportedAt === "string" ? meta.exportedAt : undefined,
    snapshot: {
      accounts: rowsToRecords(payload.Accounts),
      balanceSnapshots: rowsToRecords(payload.BalanceSnapshots),
      transactions: rowsToRecords(payload.Transactions),
      transactionLegs: rowsToRecords(payload.TransactionLegs),
      transactionSplits: rowsToRecords(payload.TransactionSplits),
      categories: rowsToRecords(payload.Categories),
      budgetCycles: rowsToRecords(payload.BudgetCycles),
      budgetAllocations: rowsToRecords(payload.BudgetAllocations),
      budgetTransfers: rowsToRecords(payload.BudgetTransfers),
      recurringRules: rowsToRecords(payload.RecurringRules),
      planInstances: rowsToRecords(payload.PlanInstances),
      subscriptions: rowsToRecords(payload.Subscriptions),
      categorisationRules: rowsToRecords(payload.CategorisationRules),
      importProfiles: rowsToRecords(payload.ImportProfiles),
      importBatches: rowsToRecords(payload.ImportBatches),
      reconciliations: rowsToRecords(payload.Reconciliations),
      reviewSessions: rowsToRecords(payload.ReviewSessions),
      settings: rowsToRecords(payload.Settings)
    } as Partial<BluehourSnapshot>
  };
}

export function currentRemoteRevision(snapshot: BluehourSnapshot): number {
  return snapshot.syncState.find((state) => state.key === "google")?.remoteRevision ?? 0;
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
      const value = inferValue(row[index]);
      if (value !== undefined) {
        record[header] = value;
      }
    });
    return record as T;
  });
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
