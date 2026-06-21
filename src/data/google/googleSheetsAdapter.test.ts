import { describe, expect, it, vi } from "vitest";
import { createBluehourSpreadsheet, extractSpreadsheetId, GOOGLE_SHEET_TABS, readSheetRanges, writeRawSheetValues } from "./googleSheetsAdapter";

describe("Google Sheets adapter", () => {
  it("extracts a spreadsheet ID from a URL or raw ID", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/abc123_DEF/edit")).toBe("abc123_DEF");
    expect(extractSpreadsheetId("raw-id")).toBe("raw-id");
  });

  it("creates a spreadsheet with the Bluehour tabs", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ spreadsheetId: "sheet-1" }), { status: 200 }));
    const id = await createBluehourSpreadsheet("token", fetcher as unknown as typeof fetch);

    expect(id).toBe("sheet-1");
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0][1].body));
    expect(body.sheets).toHaveLength(GOOGLE_SHEET_TABS.length);
  });

  it("writes values using RAW input", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    await writeRawSheetValues("sheet", "Meta!A1:B1", [["schemaVersion", 1]], "token", fetcher as unknown as typeof fetch);

    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toContain("valueInputOption=RAW");
  });

  it("reads multiple sheet ranges", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            valueRanges: [
              { range: "Meta!A1:ZZZ", values: [["key", "value"]] },
              { range: "Accounts!A1:ZZZ", values: [["id", "name"]] }
            ]
          }),
          { status: 200 }
        )
    );
    const ranges = await readSheetRanges("sheet", ["Meta!A1:ZZZ", "Accounts!A1:ZZZ"], "token", fetcher as unknown as typeof fetch);

    expect(ranges.Meta).toEqual([["key", "value"]]);
    expect(ranges.Accounts).toEqual([["id", "name"]]);
  });
});
