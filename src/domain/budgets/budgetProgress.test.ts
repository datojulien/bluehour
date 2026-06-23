import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import type { BluehourSnapshot, Transaction, TransactionSplit } from "../types";
import { buildBudgetProgressRows } from "./budgetProgress";

describe("budget progress model", () => {
  it("calculates transfer-adjusted discretionary remaining without placeholder percentages", () => {
    const snapshot = createDemoSnapshot();
    const dining = row(snapshot, "cat-dining");

    expect(dining.allocationMinor).toBe(80_000);
    expect(dining.spentMinor).toBe(3_720);
    expect(dining.reservedFuturePlansMinor).toBe(0);
    expect(dining.remainingBeforeFuturePlansMinor).toBe(76_280);
    expect(dining.remainingAfterFuturePlansMinor).toBe(76_280);
    expect(dining.remainingAfterFuturePlansMinor).not.toBe(44_000);
    expect(dining.state).toBe("on_track");
  });

  it("keeps reserved future discretionary plans separate from spent money", () => {
    const snapshot = createDemoSnapshot();
    const entertainment = row(snapshot, "cat-entertainment");

    expect(entertainment.allocationMinor).toBe(20_000);
    expect(entertainment.spentMinor).toBe(8_990);
    expect(entertainment.reservedFuturePlansMinor).toBe(8_500);
    expect(entertainment.remainingBeforeFuturePlansMinor).toBe(11_010);
    expect(entertainment.remainingAfterFuturePlansMinor).toBe(2_510);
    expect(entertainment.percentageUsedOrReserved).toBe(87);
    expect(entertainment.state).toBe("near_limit");
  });

  it("corrects spending for linked refunds and reimbursements", () => {
    const snapshot = createDemoSnapshot();
    const shopping = row(snapshot, "cat-shopping");

    expect(shopping.spentMinor).toBe(9_600);
    expect(shopping.remainingAfterFuturePlansMinor).toBe(30_400);
  });

  it("preserves negative remaining values when a category is overspent", () => {
    const snapshot = withTransaction(createDemoSnapshot(), "txn-big-dining", "cat-dining", 100_000);
    const dining = row(snapshot, "cat-dining");

    expect(dining.remainingAfterFuturePlansMinor).toBe(-23_720);
    expect(dining.state).toBe("overspent");
  });

  it("excludes archived records from spent, plans, and transfers", () => {
    const snapshot = createDemoSnapshot();
    snapshot.budgetTransfers = snapshot.budgetTransfers.map((transfer) => ({ ...transfer, archivedAt: "2026-07-12T00:00:00.000Z" }));
    snapshot.planInstances = snapshot.planInstances.map((plan) =>
      plan.id === "plan-weekend-cinema" ? { ...plan, archivedAt: "2026-07-12T00:00:00.000Z" } : plan
    );
    snapshot.transactionSplits = snapshot.transactionSplits.map((split) =>
      split.id === "split-streaming" ? { ...split, archivedAt: "2026-07-12T00:00:00.000Z" } : split
    );
    const entertainment = row(snapshot, "cat-entertainment");

    expect(entertainment.allocationMinor).toBe(30_000);
    expect(entertainment.spentMinor).toBe(0);
    expect(entertainment.reservedFuturePlansMinor).toBe(0);
    expect(entertainment.remainingAfterFuturePlansMinor).toBe(30_000);
  });

  it("marks categories without allocations explicitly", () => {
    const snapshot = createDemoSnapshot();
    const hobbies = row(snapshot, "cat-hobbies");

    expect(hobbies.allocationMinor).toBe(0);
    expect(hobbies.state).toBe("no_allocation");
  });
});

function row(snapshot: BluehourSnapshot, categoryId: string) {
  const cycle = snapshot.budgetCycles[0];
  const result = buildBudgetProgressRows({ snapshot, cycle, asOfDate: demoAsOfDate });
  const match = result.find((item) => item.categoryId === categoryId);
  if (!match) {
    throw new Error(`Missing row ${categoryId}`);
  }
  return match;
}

function withTransaction(snapshot: BluehourSnapshot, transactionId: string, categoryId: string, amountMinor: number): BluehourSnapshot {
  const transaction: Transaction = {
    id: transactionId,
    createdAt: "2026-07-12T09:00:00.000Z",
    updatedAt: "2026-07-12T09:00:00.000Z",
    archivedAt: null,
    revision: 1,
    type: "expense",
    status: "actual",
    occurredOn: demoAsOfDate,
    description: "Large test spend",
    source: "manual"
  };
  const split: TransactionSplit = {
    id: `split-${transactionId}`,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    archivedAt: null,
    revision: 1,
    transactionId,
    categoryId,
    direction: "expense",
    amountMinor
  };
  return {
    ...snapshot,
    transactions: [...snapshot.transactions, transaction],
    transactionSplits: [...snapshot.transactionSplits, split]
  };
}
