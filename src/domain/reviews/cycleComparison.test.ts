import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import type { BluehourSnapshot, BudgetCycle, Transaction, TransactionSplit } from "../types";
import { compareActiveCycleToPrevious } from "./cycleComparison";

const now = "2026-07-12T00:00:00.000Z";

describe("cycle comparison", () => {
  it("does not invent a comparison during the first cycle", () => {
    const snapshot = createDemoSnapshot();

    expect(compareActiveCycleToPrevious(snapshot, snapshot.budgetCycles[0], demoAsOfDate).unavailableReason).toContain("after another completed cycle");
  });

  it("compares the active cycle to the same elapsed point in the previous completed cycle", () => {
    const snapshot = withPreviousCycle(createDemoSnapshot());
    snapshot.transactions.push(expense("txn-prev-dining", "2026-06-12"));
    snapshot.transactionSplits.push(split("split-prev-dining", "txn-prev-dining", "cat-dining", "expense", 2_000));

    const result = compareActiveCycleToPrevious(snapshot, snapshot.budgetCycles[0], demoAsOfDate);
    const dining = result.items.find((item) => item.id === "category-cat-dining");

    expect(dining).toMatchObject({
      currentMinor: 3_720,
      previousMinor: 2_000,
      deltaMinor: 1_720
    });
  });

  it("handles refunds and excludes transfers from total spending", () => {
    const snapshot = withPreviousCycle(createDemoSnapshot());
    snapshot.transactions.push(expense("txn-prev-shopping", "2026-06-10"));
    snapshot.transactionSplits.push(split("split-prev-shopping", "txn-prev-shopping", "cat-shopping", "expense", 13_600));
    snapshot.transactions.push({ ...expense("txn-prev-refund", "2026-06-11"), type: "refund", refundOfTransactionId: "txn-prev-shopping" });
    snapshot.transactionSplits.push(split("split-prev-refund", "txn-prev-refund", "cat-shopping", "reversal", 3_000));
    snapshot.transactions.push({ ...expense("txn-prev-transfer", "2026-06-11"), type: "transfer" });
    snapshot.transactionSplits.push(split("split-prev-transfer", "txn-prev-transfer", "cat-dining", "expense", 99_999));

    const result = compareActiveCycleToPrevious(snapshot, snapshot.budgetCycles[0], demoAsOfDate);
    const shopping = result.items.find((item) => item.id === "category-cat-shopping");

    expect(shopping?.previousMinor).toBe(10_600);
    expect(result.items.find((item) => item.id === "total-spending")?.previousMinor).toBeLessThan(99_999);
  });

  it("ranks items deterministically by absolute impact", () => {
    const snapshot = withPreviousCycle(createDemoSnapshot());
    snapshot.transactions.push(expense("txn-prev-dining", "2026-06-12"));
    snapshot.transactionSplits.push(split("split-prev-dining", "txn-prev-dining", "cat-dining", "expense", 1_000));
    snapshot.transactions.push(expense("txn-prev-fuel", "2026-06-12"));
    snapshot.transactionSplits.push(split("split-prev-fuel", "txn-prev-fuel", "cat-fuel", "expense", 11_700));

    const result = compareActiveCycleToPrevious(snapshot, snapshot.budgetCycles[0], demoAsOfDate);
    const impacts = result.items.map((item) => Math.abs(item.deltaMinor ?? 0));

    expect(impacts).toEqual([...impacts].sort((left, right) => right - left));
  });
});

function withPreviousCycle(snapshot: BluehourSnapshot): BluehourSnapshot {
  const previous: BudgetCycle = {
    ...snapshot.budgetCycles[0],
    id: "cycle-2026-05-24",
    startedOn: "2026-06-01",
    endedOn: "2026-06-30",
    status: "closed",
    salaryTransactionId: "txn-prev-salary",
    expectedNextSalaryFrom: "2026-06-29",
    expectedNextSalaryTo: "2026-06-30",
    closedAt: "2026-06-30T00:00:00.000Z"
  };
  return {
    ...snapshot,
    budgetCycles: [snapshot.budgetCycles[0], previous]
  };
}

function expense(id: string, occurredOn: Transaction["occurredOn"]): Transaction {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    type: "expense",
    status: "actual",
    occurredOn,
    description: id,
    source: "manual"
  };
}

function split(id: string, transactionId: string, categoryId: string, direction: TransactionSplit["direction"], amountMinor: number): TransactionSplit {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    transactionId,
    categoryId,
    direction,
    amountMinor
  };
}
