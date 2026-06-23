import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import type { BluehourSnapshot, PlanInstance } from "../types";
import { calculateSafeToSpend, type SafeToSpendInput } from "./safeToSpend";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";

function inputFromDemo(demo: BluehourSnapshot = createDemoSnapshot(), overrides: Partial<SafeToSpendInput> = {}): SafeToSpendInput {
  const cycle = demo.budgetCycles[0];
  return {
    asOfDate: demoAsOfDate,
    horizonEndDate: addDays(cycle.expectedNextSalaryTo, -1),
    cycle,
    accounts: demo.accounts,
    balanceSnapshots: demo.balanceSnapshots,
    transactions: demo.transactions,
    transactionLegs: demo.transactionLegs,
    transactionSplits: demo.transactionSplits,
    categories: demo.categories,
    budgetAllocations: demo.budgetAllocations,
    budgetTransfers: demo.budgetTransfers,
    planInstances: demo.planInstances,
    extraIncomeAllocations: demo.extraIncomeAllocations,
    includeFutureIncome: false,
    ...overrides
  };
}

describe("safe-to-spend engine", () => {
  it("calculates the demo available-now result with full reserves", () => {
    const result = calculateSafeToSpend(inputFromDemo());

    expect(result.netSpendableBalanceMinor).toBe(531_360);
    expect(result.countedFutureIncomeMinor).toBe(0);
    expect(result.committedReserveMinor).toBe(47_700);
    expect(result.essentialEnvelopeReserveMinor).toBe(115_670);
    expect(result.protectedReserveMinor).toBe(0);
    expect(result.bufferReserveMinor).toBe(50_000);
    expect(result.cashCapacityMinor).toBe(317_990);
    expect(result.discretionaryRemainderMinor).toBe(109_190);
    expect(result.safeToSpendMinor).toBe(109_190);
    expect(result.dailyAmountMinor).toBe(7_799);
    expect(result.lowestProjectedBalanceMinor).toBe(483_660);
  });

  it("adds confirmed income to projected figures but never possible income", () => {
    const demo = createDemoSnapshot();
    const result = calculateSafeToSpend(
      inputFromDemo(demo, {
        horizonEndDate: "2026-08-10",
        includeFutureIncome: true
      })
    );

    expect(result.breakdown.includedIncome.map((income) => income.label)).toEqual([
      "Confirmed freelance payment",
      "Main salary estimate"
    ]);
    expect(result.breakdown.excludedIncome.map((income) => income.label)).toContain("Possible campaign bonus");
    expect(result.countedFutureIncomeMinor).toBe(815_000);
  });

  it("does not double-count plan-reserved committed categories as envelope reserves", () => {
    const result = calculateSafeToSpend(inputFromDemo());

    expect(result.breakdown.committedPlans.map((plan) => plan.label)).toContain("Electricity estimate");
    expect(result.breakdown.essentialEnvelopeReserves.map((reserve) => reserve.label)).not.toContain("Utilities");
  });

  it("protects known essential spending when it is larger than the envelope remainder", () => {
    const result = calculateSafeToSpend(inputFromDemo());
    const household = result.breakdown.essentialEnvelopeReserves.find((reserve) => reserve.label === "Household");

    expect(household?.amountMinor).toBe(28_000);
  });

  it("calculates protected target from actual salary and completed protected transfers", () => {
    const demo = createDemoSnapshot();
    const withoutProtectedTransfer = demo.transactionLegs.map((leg) =>
      leg.id === "leg-savings-protected" ? { ...leg, archivedAt: "2026-07-12T00:00:00.000Z" } : leg
    );

    const result = calculateSafeToSpend(
      inputFromDemo(demo, {
        transactionLegs: withoutProtectedTransfer,
        cycle: { ...demo.budgetCycles[0], additionalProtectedCommitmentMinor: 5_000 }
      })
    );

    expect(result.breakdown.protectedTargetMinor).toBe(83_000);
    expect(result.breakdown.completedProtectedMinor).toBe(0);
    expect(result.protectedReserveMinor).toBe(83_000);
  });

  it("reserves pending savings goal contributions as protected savings", () => {
    const demo = createDemoSnapshot();
    const pendingContribution = {
      ...demo.savingsGoalContributions[0],
      id: "goal-contribution-pending-test",
      amountMinor: 20_000,
      source: "save_difference" as const,
      status: "pending_transfer" as const,
      linkedBudgetCycleId: demo.budgetCycles[0].id
    };
    const result = calculateSafeToSpend(
      inputFromDemo(demo, {
        savingsGoalContributions: [...demo.savingsGoalContributions, pendingContribution]
      })
    );

    expect(result.breakdown.protectedTargetMinor).toBe(98_000);
    expect(result.protectedReserveMinor).toBe(18_000);
  });

  it("uses the larger of RM500 or 10% of remaining essential obligations for the buffer", () => {
    const demo = createDemoSnapshot();
    const largePlan: PlanInstance = {
      ...demo.planInstances[0],
      id: "plan-large-contract",
      name: "Large contractual payment",
      expectedAmountMinor: 800_000,
      categoryId: "cat-insurance",
      expectedDate: "2026-07-14"
    };

    const result = calculateSafeToSpend(inputFromDemo(demo, { planInstances: [...demo.planInstances, largePlan] }));

    expect(result.bufferReserveMinor).toBe(96_337);
  });

  it("shows RM0 safe-to-spend and a shortfall when cash capacity is negative", () => {
    const demo = createDemoSnapshot();
    const lowCash = demo.balanceSnapshots.map((snapshot) =>
      snapshot.accountId === "acc-meranti-current" ? { ...snapshot, amountMinor: -300_000 } : snapshot
    );
    const result = calculateSafeToSpend(inputFromDemo(demo, { balanceSnapshots: lowCash }));

    expect(result.cashCapacityMinor).toBeLessThan(0);
    expect(result.safeToSpendMinor).toBe(0);
    expect(result.shortfallMinor).toBeGreaterThan(0);
    expect(result.breakdown.warnings).toContain("Projected cash capacity is below zero before discretionary spending.");
  });

  it("is never negative and never exceeds the discretionary remainder", () => {
    const demo = createDemoSnapshot();

    for (const amountMinor of [-500_000, -50_000, 0, 120_000, 600_000]) {
      const snapshots = demo.balanceSnapshots.map((snapshot) =>
        snapshot.accountId === "acc-meranti-current" ? { ...snapshot, amountMinor } : snapshot
      );
      const result = calculateSafeToSpend(inputFromDemo(demo, { balanceSnapshots: snapshots }));

      expect(result.safeToSpendMinor).toBeGreaterThanOrEqual(0);
      expect(result.safeToSpendMinor).toBeLessThanOrEqual(result.discretionaryRemainderMinor);
    }
  });

  it("excludes archived plans from reserves", () => {
    const demo = createDemoSnapshot();
    const archivedPlans = demo.planInstances.map((plan) =>
      plan.id === "plan-insurance" ? { ...plan, archivedAt: "2026-07-12T00:00:00.000Z" } : plan
    );
    const result = calculateSafeToSpend(inputFromDemo(demo, { planInstances: archivedPlans }));

    expect(result.committedReserveMinor).toBe(29_700);
  });
});
