import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { calculateSafeToSpend } from "../forecasting/safeToSpend";
import type { Transaction } from "../types";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import {
  activeCycleForIncome,
  createExtraIncomeAllocation,
  linkProtectedExtraIncomeTransfer,
  pendingProtectedExtraIncomeMinor,
  shouldPromptForExtraIncome
} from "./extraIncomeAllocation";

const now = "2026-07-12T00:00:00.000Z";

describe("extra-income allocation", () => {
  it("does not prompt for the main salary but prompts for actual non-main income", () => {
    const snapshot = createDemoSnapshot();
    const salary = snapshot.transactions.find((transaction) => transaction.id === "txn-salary-june")!;
    const extra = income("txn-extra", "2026-07-12");

    expect(shouldPromptForExtraIncome(salary, snapshot)).toBe(false);
    expect(shouldPromptForExtraIncome(extra, snapshot)).toBe(true);
  });

  it("validates exact amount reconciliation for manual splits", () => {
    expect(() =>
      createExtraIncomeAllocation({
        incomeTransactionId: "txn-extra",
        incomeAmountMinor: 10_000,
        availableMinor: 6_000,
        protectedMinor: 3_999
      })
    ).toThrow(/must equal/);

    expect(
      createExtraIncomeAllocation({
        incomeTransactionId: "txn-extra",
        incomeAmountMinor: 10_000,
        availableMinor: 6_000,
        protectedMinor: 4_000
      })
    ).toMatchObject({ status: "pending_transfer" });
  });

  it("reduces safe-to-spend for pending protected commitments and stops after completion", () => {
    const snapshot = createDemoSnapshot();
    const cycle = snapshot.budgetCycles[0];
    const pending = createExtraIncomeAllocation({
      incomeTransactionId: "txn-extra",
      budgetCycleId: cycle.id,
      incomeAmountMinor: 5_000,
      availableMinor: 0,
      protectedMinor: 5_000
    });
    const withPending = { ...snapshot, extraIncomeAllocations: [pending] };
    const pendingResult = calculateSafeToSpend({
      asOfDate: demoAsOfDate,
      horizonEndDate: addDays(cycle.expectedNextSalaryTo, -1),
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
      extraIncomeAllocations: withPending.extraIncomeAllocations,
      includeFutureIncome: false
    });
    const completed = linkProtectedExtraIncomeTransfer(pending, "txn-protected-transfer");

    expect(pendingProtectedExtraIncomeMinor(withPending, cycle)).toBe(5_000);
    expect(pendingResult.protectedReserveMinor).toBe(3_000);
    expect(pendingProtectedExtraIncomeMinor({ extraIncomeAllocations: [completed] }, cycle)).toBe(0);
  });

  it("can defer a decision without blocking the original income transaction", () => {
    const allocation = createExtraIncomeAllocation({
      incomeTransactionId: "txn-extra",
      incomeAmountMinor: 8_000,
      availableMinor: 8_000,
      protectedMinor: 0,
      status: "deferred"
    });

    expect(allocation.status).toBe("deferred");
    expect(allocation.availableMinor + allocation.protectedMinor).toBe(allocation.incomeAmountMinor);
  });

  it("finds the active cycle for received extra income", () => {
    const snapshot = createDemoSnapshot();
    expect(activeCycleForIncome(income("txn-extra", "2026-07-12"), snapshot.budgetCycles)?.id).toBe("cycle-2026-06-24");
  });
});

function income(id: string, occurredOn: Transaction["occurredOn"]): Transaction {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    type: "income",
    status: "actual",
    occurredOn,
    description: "Extra income",
    source: "manual"
  };
}
