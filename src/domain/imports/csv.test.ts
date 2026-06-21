import { describe, expect, it } from "vitest";
import { escapeCsvCell, parseCsv, parseCsvDate, toCsv } from "./csv";

describe("CSV helpers", () => {
  it("parses quoted CSV locally", () => {
    const parsed = parseCsv('date,description,amount\n2026-07-12,"Banyan, Market",-12.30');

    expect(parsed.headers).toEqual(["date", "description", "amount"]);
    expect(parsed.rows[0]).toEqual({
      date: "2026-07-12",
      description: "Banyan, Market",
      amount: "-12.30"
    });
  });

  it("escapes formula-triggering exported text", () => {
    expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(toCsv(["description"], [{ description: "@cmd" }])).toContain("'@cmd");
  });

  it("parses supported local-date formats", () => {
    expect(parseCsvDate("2026-07-12", "YYYY-MM-DD")).toBe("2026-07-12");
    expect(parseCsvDate("12/07/2026", "DD/MM/YYYY")).toBe("2026-07-12");
  });
});
