export const BLUEHOUR_SCHEMA_VERSION = 4;

export const GOOGLE_DOMAIN_TABS = [
  "Accounts",
  "BalanceSnapshots",
  "Transactions",
  "TransactionLegs",
  "TransactionSplits",
  "Categories",
  "BudgetCycles",
  "BudgetAllocations",
  "BudgetTransfers",
  "RecurringRules",
  "PlanInstances",
  "Subscriptions",
  "ExtraIncomeAllocations",
  "CategorisationRules",
  "ImportProfiles",
  "ImportBatches",
  "ImportRowAudits",
  "Reconciliations",
  "ReviewSessions",
  "Settings"
] as const;

export const GOOGLE_SHEET_SLOTS = ["A", "B"] as const;
export type GoogleSheetSlot = (typeof GOOGLE_SHEET_SLOTS)[number];

export const GOOGLE_SHEET_TABS = [
  "Meta",
  ...GOOGLE_SHEET_SLOTS.flatMap((slot) => GOOGLE_DOMAIN_TABS.map((tab) => `${slot}_${tab}`))
] as const;

export interface ConnectionDescriptor {
  spreadsheetId: string;
  sheetSchemaVersion: number;
  profileId: string;
  lastKnownRemoteRevision: number;
  lastSuccessfulSyncAt?: string;
}

export interface GoogleDriveFileSummary {
  id: string;
  name: string;
  modifiedTime?: string;
}

interface GoogleApiErrorBody {
  error?: {
    message?: unknown;
    status?: unknown;
  } | string;
  error_description?: unknown;
  message?: unknown;
}

export function createConnectionDescriptor(
  spreadsheetId: string,
  {
    profileId,
    lastKnownRemoteRevision = 0,
    lastSuccessfulSyncAt
  }: {
    profileId: string;
    lastKnownRemoteRevision?: number;
    lastSuccessfulSyncAt?: string;
  }
): ConnectionDescriptor {
  return {
    spreadsheetId,
    sheetSchemaVersion: BLUEHOUR_SCHEMA_VERSION,
    profileId,
    lastKnownRemoteRevision,
    lastSuccessfulSyncAt
  };
}

export function parseConnectionDescriptor(value: unknown): ConnectionDescriptor {
  if (!isRecord(value)) {
    throw new Error("Google connection descriptor must be an object");
  }

  const spreadsheetId = stringValue(value.spreadsheetId);
  const profileId = stringValue(value.profileId);
  const sheetSchemaVersion = integerValue(value.sheetSchemaVersion ?? value.schemaVersion);
  const lastKnownRemoteRevision = integerValue(value.lastKnownRemoteRevision ?? 0);
  const lastSuccessfulSyncAt = stringValue(value.lastSuccessfulSyncAt);

  if (!spreadsheetId) {
    throw new Error("Google connection descriptor is missing a spreadsheet ID");
  }

  if (!profileId) {
    throw new Error("Google connection descriptor is missing a profile ID");
  }

  if (sheetSchemaVersion === undefined) {
    throw new Error("Google connection descriptor is missing a Sheet schema version");
  }

  if (lastKnownRemoteRevision === undefined) {
    throw new Error("Google connection descriptor has an invalid remote revision");
  }

  return {
    spreadsheetId,
    sheetSchemaVersion,
    profileId,
    lastKnownRemoteRevision,
    lastSuccessfulSyncAt: lastSuccessfulSyncAt ?? undefined
  };
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

export async function listBluehourSpreadsheets(accessToken: string, fetcher: typeof fetch = fetch): Promise<GoogleDriveFileSummary[]> {
  const query = [
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "trashed = false",
    "name contains 'Bluehour'"
  ].join(" and ");
  const search = new URLSearchParams({
    q: query,
    fields: "files(id,name,modifiedTime)",
    pageSize: "10",
    orderBy: "modifiedTime desc"
  });
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${search.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await googleSheetsFailureMessage(response, "Google Drive file search"));
  }

  const body = (await response.json()) as { files?: unknown[] };
  return (body.files ?? []).filter(isGoogleDriveFileSummary);
}

export async function createBluehourSpreadsheet(accessToken: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: {
        title: "Bluehour Finance Data"
      },
      sheets: GOOGLE_SHEET_TABS.map((title) => ({
        properties: {
          title
        }
      }))
    })
  });

  if (!response.ok) {
    throw new Error(await googleSheetsFailureMessage(response, "Google Sheets create"));
  }

  const body = (await response.json()) as { spreadsheetId?: string };
  if (!body.spreadsheetId) {
    throw new Error("Google did not return a spreadsheet ID");
  }

  return body.spreadsheetId;
}

export async function readGoogleSpreadsheetTabTitles(
  spreadsheetId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<string[]> {
  const response = await fetcher(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(await googleSheetsFailureMessage(response, "Google Sheets metadata read"));
  }

  const body = (await response.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
  return (body.sheets ?? []).map((sheet) => sheet.properties?.title).filter((title): title is string => Boolean(title));
}

export async function ensureBluehourSheetSchema(
  spreadsheetId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<string[]> {
  const existingTitles = new Set(await readGoogleSpreadsheetTabTitles(spreadsheetId, accessToken, fetcher));
  const missingTitles = GOOGLE_SHEET_TABS.filter((title) => !existingTitles.has(title));
  if (missingTitles.length === 0) {
    return [];
  }

  const response = await fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: missingTitles.map((title) => ({
        addSheet: {
          properties: {
            title
          }
        }
      }))
    })
  });

  if (!response.ok) {
    throw new Error(await googleSheetsFailureMessage(response, "Google Sheets schema prepare"));
  }

  return missingTitles;
}

export async function writeRawSheetValues(
  spreadsheetId: string,
  range: string,
  values: unknown[][],
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const response = await fetcher(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        majorDimension: "ROWS",
        values
      })
    }
  );

  if (!response.ok) {
    throw new Error(await googleSheetsFailureMessage(response, "Google Sheets write"));
  }
}

export async function clearSheetValues(
  spreadsheetId: string,
  range: string,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const response = await fetcher(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    }
  );

  if (!response.ok) {
    throw new Error(await googleSheetsFailureMessage(response, "Google Sheets clear"));
  }
}

export async function readSheetRanges(
  spreadsheetId: string,
  ranges: readonly string[],
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<Record<string, unknown[][]>> {
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const response = await fetcher(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(await googleSheetsFailureMessage(response, "Google Sheets read"));
  }

  const body = (await response.json()) as {
    valueRanges?: Array<{ range?: string; values?: unknown[][] }>;
  };

  return Object.fromEntries(
    (body.valueRanges ?? []).map((valueRange, index) => {
      const tabName = ranges[index].split("!")[0];
      return [tabName, valueRange.values ?? []];
    })
  );
}

async function googleSheetsFailureMessage(response: Response, action: string): Promise<string> {
  const detail = await readGoogleErrorDetail(response);
  return detail ? `${action} failed with ${response.status}: ${detail}` : `${action} failed with ${response.status}`;
}

async function readGoogleErrorDetail(response: Response): Promise<string | null> {
  let responseText: string;
  try {
    responseText = await response.clone().text();
  } catch {
    return null;
  }

  const trimmed = responseText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const body = JSON.parse(trimmed) as GoogleApiErrorBody;
    const parsed = parseGoogleErrorBody(body);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall back to the raw response text below.
  }

  return collapseWhitespace(trimmed).slice(0, 500);
}

function parseGoogleErrorBody(body: GoogleApiErrorBody): string | null {
  if (isRecord(body.error)) {
    return [stringValue(body.error.status), stringValue(body.error.message)].filter(Boolean).join(": ") || null;
  }

  return stringValue(body.error) ?? stringValue(body.error_description) ?? stringValue(body.message) ?? null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = collapseWhitespace(value.trim());
  return trimmed || null;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGoogleDriveFileSummary(value: unknown): value is GoogleDriveFileSummary {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}
