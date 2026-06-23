import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import { buildBudgetRows } from "./budgetRows";

describe("dashboard budget rows", () => {
  it("keeps display amounts as integer sen", () => {
    const snapshot = createDemoSnapshot();
    const cycle = snapshot.budgetCycles[0];
    const rows = buildBudgetRows(snapshot, cycle, demoAsOfDate);

    expect(rows.every((row) => Number.isInteger(row.remainingAfterFuturePlansMinor))).toBe(true);
    expect(rows.every((row) => Number.isInteger(row.reservedFuturePlansMinor))).toBe(true);
  });
});
