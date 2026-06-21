import { describe, expect, it } from "vitest";
import { calculateSafeToSpend } from "../../domain/forecasting/safeToSpend";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import { buildBudgetRows } from "./budgetRows";

describe("dashboard budget rows", () => {
  it("keeps display amounts as integer sen", () => {
    const snapshot = createDemoSnapshot();
    const cycle = snapshot.budgetCycles[0];
    const result = calculateSafeToSpend({
      asOfDate: demoAsOfDate,
      horizonEndDate: "2026-07-25",
      cycle,
      accounts: snapshot.accounts,
      balanceSnapshots: snapshot.balanceSnapshots,
      transactions: snapshot.transactions,
      transactionLegs: snapshot.transactionLegs,
      transactionSplits: snapshot.transactionSplits,
      categories: snapshot.categories,
      budgetAllocations: snapshot.budgetAllocations,
      budgetTransfers: snapshot.budgetTransfers,
      planInstances: snapshot.planInstances,
      includeFutureIncome: false
    });

    expect(buildBudgetRows(snapshot, result).every((row) => Number.isInteger(row.remaining))).toBe(true);
  });
});
