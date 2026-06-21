export const BLUEHOUR_SCHEMA_VERSION = 1;

export const GOOGLE_SHEET_TABS = [
  "Meta",
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
  "CategorisationRules",
  "ImportProfiles",
  "ImportBatches",
  "Reconciliations",
  "ReviewSessions",
  "Settings"
] as const;

export interface ConnectionDescriptor {
  spreadsheetId: string;
  schemaVersion: number;
}

export function createConnectionDescriptor(spreadsheetId: string): ConnectionDescriptor {
  return {
    spreadsheetId,
    schemaVersion: BLUEHOUR_SCHEMA_VERSION
  };
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  return match?.[1] ?? trimmed;
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
    throw new Error(`Google Sheets create failed with ${response.status}`);
  }

  const body = (await response.json()) as { spreadsheetId?: string };
  if (!body.spreadsheetId) {
    throw new Error("Google did not return a spreadsheet ID");
  }

  return body.spreadsheetId;
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
    throw new Error(`Google Sheets write failed with ${response.status}`);
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
    throw new Error(`Google Sheets clear failed with ${response.status}`);
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
    throw new Error(`Google Sheets read failed with ${response.status}`);
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
