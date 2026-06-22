import { describe, expect, it } from "vitest";
import { calculateCashFlowProjection } from "./cashFlowProjection";
import type {
  Account,
  BalanceSnapshot,
  BluehourSnapshot,
  BudgetAllocation,
  BudgetCycle,
  Category,
  IsoDate,
  PlanInstance,
  RecurringRule,
  Subscription,
  Transaction,
  TransactionLeg
} from "../types";

const now = "2026-07-01T00:00:00.000Z";

function meta(id: string) {
  return { id, createdAt: now, updatedAt: now, archivedAt: null, revision: 1 };
}

function testSnapshot(overrides: Partial<BluehourSnapshot> = {}): BluehourSnapshot {
  const accounts: Account[] = [
    account("acc-bank", "Test Current", "bank", "spendable"),
    account("acc-wallet", "Test Wallet", "ewallet", "spendable"),
    account("acc-card", "Test Card", "credit_card", "liability"),
    account("acc-protected", "Test Protected", "savings", "protected"),
    account("acc-invest", "Test Investment", "investment", "investment")
  ];
  const categories: Category[] = [
    category("cat-committed", "Committed bill", "committed", "essential", "plan", 1),
    category("cat-essential", "Groceries", "essential_flexible", "essential", "envelope", 2),
    category("cat-discretionary", "Dining", "discretionary", "discretionary", "envelope", 3),
    category("cat-protected", "Savings", "protected", "protected", "protected", 4),
    category("cat-income", "Income", "administrative", "administrative", "none", 5),
    category("cat-transfer", "Transfers", "administrative", "administrative", "none", 6)
  ];
  const cycle: BudgetCycle = {
    ...meta("cycle-current"),
    startedOn: "2026-07-01",
    status: "open",
    salaryTransactionId: "txn-salary",
    expectedNextSalaryFrom: "2026-07-24",
    expectedNextSalaryTo: "2026-07-26",
    protectedRateBasisPoints: 1_000,
    bufferMinimumMinor: 5_000,
    bufferEssentialRateBasisPoints: 1_000,
    actualMainSalaryMinor: 100_000
  };
  const snapshot: BluehourSnapshot = {
    accounts,
    balanceSnapshots: [balance("bal-bank", "acc-bank", "2026-06-30", 50_000), balance("bal-card", "acc-card", "2026-06-30", 0)],
    transactions: [],
    transactionLegs: [],
    transactionSplits: [],
    categories,
    budgetCycles: [cycle],
    budgetAllocations: [
      allocation("alloc-essential", cycle.id, "cat-essential", 10_000),
      allocation("alloc-discretionary", cycle.id, "cat-discretionary", 50_000)
    ],
    budgetTransfers: [],
    recurringRules: [],
    planInstances: [
      plan("plan-salary", "income", "Main salary estimate", "2026-07-26", 100_000, undefined, "expected", {
        isMainSalaryEstimate: true,
        windowStartDate: "2026-07-24",
        windowEndDate: "2026-07-26",
        accountId: "acc-bank"
      })
    ],
    subscriptions: [],
    categorisationRules: [],
    importProfiles: [],
    importBatches: [],
    importRowAudits: [],
    reconciliations: [],
    reviewSessions: [],
    settings: [],
    outboxOperations: [],
    conflicts: [],
    syncState: [{ key: "google", status: "demo" }]
  };

  return { ...snapshot, ...overrides };
}

describe("cash-flow projection", () => {
  it("owns payday in the future segment and counts payday events exactly once", () => {
    const snapshot = testSnapshot();
    const paydayExpense = plan("plan-payday-expense", "expense", "Payday bill", "2026-07-26", 12_000, "cat-committed", "confirmed", {
      accountId: "acc-bank"
    });
    const paydayEssential = plan("plan-payday-essential", "expense", "Payday groceries", "2026-07-26", 4_000, "cat-essential", "confirmed", {
      accountId: "acc-bank"
    });
    const confirmedIncome = plan("plan-payday-income", "income", "Confirmed side income", "2026-07-26", 7_500, undefined, "confirmed", {
      accountId: "acc-bank"
    });
    const possibleIncome = plan("plan-payday-possible", "income", "Possible side income", "2026-07-26", 9_000, undefined, "possible", {
      accountId: "acc-bank"
    });
    const subscriptionRule: RecurringRule = {
      ...meta("rule-payday-subscription"),
      name: "Payday Cloud",
      kind: "subscription",
      frequency: "monthly",
      interval: 1,
      startDate: "2026-07-26",
      dayOfMonth: 26,
      amountMode: "fixed",
      amountMinor: 2_200,
      fromAccountId: "acc-card",
      categoryId: "cat-discretionary",
      essential: false,
      active: true
    };
    const subscription: Subscription = {
      ...meta("sub-payday-cloud"),
      recurringRuleId: subscriptionRule.id,
      provider: "Payday Cloud",
      billingFrequency: "monthly",
      nextPaymentDate: "2026-07-26",
      essential: false
    };
    const projection = calculateCashFlowProjection({
      snapshot: {
        ...snapshot,
        recurringRules: [subscriptionRule],
        subscriptions: [subscription],
        planInstances: [...snapshot.planInstances, paydayExpense, paydayEssential, confirmedIncome, possibleIncome]
      },
      cycle: snapshot.budgetCycles[0],
      asOfDate: "2026-07-20",
      horizonEndDate: "2026-08-05"
    });

    expect(projection.segments[0]).toMatchObject({ startDate: "2026-07-20", endDate: "2026-07-25", isVirtual: false });
    expect(projection.segments[1]).toMatchObject({ startDate: "2026-07-26", endDate: "2026-08-05", isVirtual: true });
    expect(totalFor(projection.events, "virtual-main-salary")).toBe(100_000);
    expect(eventsForSource(projection.events, paydayExpense.id)).toHaveLength(1);
    expect(totalFor(projection.events, paydayExpense.id)).toBe(-12_000);
    expect(eventsForSource(projection.events, paydayEssential.id)).toHaveLength(1);
    expect(totalFor(projection.events, paydayEssential.id)).toBe(-4_000);
    expect(eventsForSource(projection.events, subscription.id)).toHaveLength(1);
    expect(totalFor(projection.events, subscription.id)).toBe(-2_200);
    expect(eventsForSource(projection.events, confirmedIncome.id)).toHaveLength(1);
    expect(totalFor(projection.events, confirmedIncome.id)).toBe(7_500);
    expect(eventsForSource(projection.events, possibleIncome.id)).toHaveLength(0);
    expect(projection.excludedIncome).toContainEqual(
      expect.objectContaining({ sourceId: possibleIncome.id, amountMinor: 9_000, date: "2026-07-26" })
    );
    expect(projection.segments[1].protectedTargetMinor).toBe(10_000);
    expect(projection.events.filter((event) => event.id.startsWith("protected-assumption-cycle-current-virtual-next"))).toHaveLength(1);
    expect(totalFor(projection.events, "protected-assumption-cycle-current-virtual-next")).toBe(-10_000);
    expect(projection.events.filter((event) => event.kind === "essential_distribution" && event.date >= "2026-07-26")).toHaveLength(11);
    expect(new Set(projection.events.map((event) => event.id)).size).toBe(projection.events.length);
  });

  it("keeps early holiday, month-end, and leap-year salary boundaries unambiguous", () => {
    const snapshot = testSnapshot({
      budgetCycles: [
        {
          ...testSnapshot().budgetCycles[0],
          expectedNextSalaryFrom: "2026-07-22",
          expectedNextSalaryTo: "2026-07-22"
        }
      ]
    });
    const early = calculateCashFlowProjection({
      snapshot,
      cycle: snapshot.budgetCycles[0],
      asOfDate: "2026-07-20",
      horizonEndDate: "2026-07-31"
    });

    expect(early.segments[0].endDate).toBe("2026-07-21");
    expect(early.segments[1].startDate).toBe("2026-07-22");

    const leapSnapshot = testSnapshot({
      budgetCycles: [
        {
          ...testSnapshot().budgetCycles[0],
          startedOn: "2028-01-31",
          expectedNextSalaryFrom: "2028-02-24",
          expectedNextSalaryTo: "2028-02-29"
        }
      ],
      planInstances: [
        {
          ...testSnapshot().planInstances[0],
          expectedDate: "2028-02-29",
          windowStartDate: "2028-02-24",
          windowEndDate: "2028-02-29"
        }
      ]
    });
    const leap = calculateCashFlowProjection({
      snapshot: leapSnapshot,
      cycle: leapSnapshot.budgetCycles[0],
      asOfDate: "2028-02-20",
      horizonEndDate: "2028-03-05"
    });

    expect(leap.segments[0].endDate).toBe("2028-02-28");
    expect(leap.segments[1].startDate).toBe("2028-02-29");
  });

  it("distributes undated essential reserves with integer remainder on the final day", () => {
    const snapshot = testSnapshot({
      planInstances: [],
      budgetCycles: [
        {
          ...testSnapshot().budgetCycles[0],
          expectedNextSalaryTo: "2026-07-10"
        }
      ],
      budgetAllocations: [allocation("alloc-essential", "cycle-current", "cat-essential", 10_000)]
    });
    const projection = calculateCashFlowProjection({
      snapshot,
      cycle: snapshot.budgetCycles[0],
      asOfDate: "2026-07-01",
      horizonEndDate: "2026-07-03"
    });

    expect(projection.events.filter((event) => event.kind === "essential_distribution").map((event) => event.deltaMinor)).toEqual([
      -3_333,
      -3_333,
      -3_334
    ]);
    expect(projection.assumptions.join(" ")).toContain("remainder sen lands on the final day");
  });

  it("does not double-count a dated essential plan larger than its envelope", () => {
    const datedPlan = plan("plan-essential-large", "expense", "Essential repair", "2026-07-02", 12_000, "cat-essential", "confirmed", {
      accountId: "acc-bank"
    });
    const snapshot = testSnapshot({
      planInstances: [datedPlan],
      budgetAllocations: [allocation("alloc-essential", "cycle-current", "cat-essential", 10_000)]
    });
    const projection = calculateCashFlowProjection({
      snapshot,
      cycle: snapshot.budgetCycles[0],
      asOfDate: "2026-07-01",
      horizonEndDate: "2026-07-03"
    });

    expect(totalFor(projection.events, datedPlan.id)).toBe(-12_000);
    expect(projection.events.filter((event) => event.kind === "essential_distribution")).toHaveLength(0);
    expect(projection.segments[0].essentialReserveMinor).toBe(12_000);
  });

  it("creates protected assumptions after completed and partially completed transfers", () => {
    const transfer: Transaction = { ...meta("txn-transfer"), type: "transfer", status: "actual", occurredOn: "2026-07-03", description: "Protected transfer", source: "manual" };
    const legs: TransactionLeg[] = [
      leg("leg-bank-protected", transfer.id, "acc-bank", -4_000),
      leg("leg-protected", transfer.id, "acc-protected", 4_000)
    ];
    const snapshot = testSnapshot({
      transactions: [transfer],
      transactionLegs: legs
    });
    const projection = calculateCashFlowProjection({
      snapshot,
      cycle: snapshot.budgetCycles[0],
      asOfDate: "2026-07-05",
      horizonEndDate: "2026-07-07"
    });

    expect(totalFor(projection.events, "protected-assumption-cycle-current")).toBe(-6_000);
    expect(projection.assumptions.join(" ")).toContain("not an actual scheduled bank transfer");
  });

  it("calculates transfer cash impact from account roles", () => {
    const plans = [
      plan("plan-bank-wallet", "transfer", "Wallet top-up", "2026-07-02", 1_000, "cat-transfer", "confirmed", {
        fromAccountId: "acc-bank",
        toAccountId: "acc-wallet"
      }),
      plan("plan-bank-protected", "transfer", "Protected savings", "2026-07-02", 2_000, "cat-protected", "confirmed", {
        fromAccountId: "acc-bank",
        toAccountId: "acc-protected"
      }),
      plan("plan-card-payment", "transfer", "Card payment", "2026-07-02", 3_000, "cat-transfer", "confirmed", {
        fromAccountId: "acc-bank",
        toAccountId: "acc-card"
      }),
      plan("plan-bank-invest", "transfer", "Investment transfer", "2026-07-02", 4_000, "cat-transfer", "confirmed", {
        fromAccountId: "acc-bank",
        toAccountId: "acc-invest"
      })
    ];
    const projection = calculateCashFlowProjection({
      snapshot: testSnapshot({ planInstances: plans }),
      cycle: testSnapshot().budgetCycles[0],
      asOfDate: "2026-07-01",
      horizonEndDate: "2026-07-03"
    });

    expect(totalFor(projection.events, "plan-bank-wallet")).toBe(0);
    expect(totalFor(projection.events, "plan-bank-protected")).toBe(-2_000);
    expect(totalFor(projection.events, "plan-card-payment")).toBe(0);
    expect(totalFor(projection.events, "plan-bank-invest")).toBe(-4_000);
  });

  it("includes discretionary plans, subscriptions, confirmed income, and excludes possible income", () => {
    const subscriptionRule: RecurringRule = {
      ...meta("rule-stream"),
      name: "Stream Box",
      kind: "subscription",
      frequency: "monthly",
      interval: 1,
      startDate: "2026-07-02",
      amountMode: "fixed",
      amountMinor: 1_300,
      fromAccountId: "acc-card",
      categoryId: "cat-discretionary",
      essential: false,
      active: true
    };
    const subscription: Subscription = {
      ...meta("sub-stream"),
      recurringRuleId: subscriptionRule.id,
      provider: "Stream Box",
      billingFrequency: "monthly",
      nextPaymentDate: "2026-07-02",
      essential: false
    };
    const discretionary = plan("plan-dining", "expense", "Reserved dinner", "2026-07-02", 2_500, "cat-discretionary", "confirmed", {
      accountId: "acc-card"
    });
    const confirmed = plan("plan-income-confirmed", "income", "Confirmed project", "2026-07-02", 8_000, undefined, "confirmed", {
      accountId: "acc-bank"
    });
    const possible = plan("plan-income-possible", "income", "Possible project", "2026-07-02", 9_000, undefined, "possible", {
      accountId: "acc-bank"
    });
    const projection = calculateCashFlowProjection({
      snapshot: testSnapshot({
        recurringRules: [subscriptionRule],
        subscriptions: [subscription],
        planInstances: [discretionary, confirmed, possible]
      }),
      cycle: testSnapshot().budgetCycles[0],
      asOfDate: "2026-07-01",
      horizonEndDate: "2026-07-03"
    });

    expect(totalFor(projection.events, discretionary.id)).toBe(-2_500);
    expect(totalFor(projection.events, subscription.id)).toBe(-1_300);
    expect(totalFor(projection.events, confirmed.id)).toBe(8_000);
    expect(eventsForSource(projection.events, possible.id)).toHaveLength(0);
    expect(projection.excludedIncome).toContainEqual(expect.objectContaining({ sourceId: possible.id, amountMinor: 9_000 }));
  });

  it("finds lowest projected balance, first date below buffer, and reconciles closing balance exactly", () => {
    const snapshot = testSnapshot({
      balanceSnapshots: [balance("bal-bank", "acc-bank", "2026-06-30", 20_000)],
      budgetAllocations: [],
      budgetCycles: [{ ...testSnapshot().budgetCycles[0], protectedRateBasisPoints: 0 }],
      planInstances: [plan("plan-large", "expense", "Large bill", "2026-07-02", 18_000, "cat-committed", "confirmed", { accountId: "acc-bank" })]
    });
    const projection = calculateCashFlowProjection({
      snapshot,
      cycle: snapshot.budgetCycles[0],
      asOfDate: "2026-07-01",
      horizonEndDate: "2026-07-03"
    });

    expect(projection.lowestProjectedBalanceMinor).toBe(2_000);
    expect(projection.lowestProjectedBalanceDate).toBe("2026-07-02");
    expect(projection.firstBelowBufferDate).toBe("2026-07-02");
    expect(projection.closingBalanceMinor).toBe(
      projection.reconciliation.startingNetSpendableMinor +
        projection.reconciliation.positiveProjectedDeltaMinor -
        projection.reconciliation.projectedCashImpactingObligationsMinor
    );
  });
});

function account(id: string, name: string, type: Account["type"], role: Account["role"]): Account {
  return {
    ...meta(id),
    name,
    type,
    role,
    trackingMode: "ledger",
    currency: "MYR",
    reconcileWeekly: true,
    sortOrder: 1
  };
}

function balance(id: string, accountId: string, asOfDate: IsoDate, amountMinor: number): BalanceSnapshot {
  return { ...meta(id), accountId, asOfDate, amountMinor, source: "opening" };
}

function category(
  id: string,
  name: string,
  group: Category["group"],
  nature: Category["nature"],
  reservationMode: Category["reservationMode"],
  sortOrder: number
): Category {
  return { ...meta(id), name, group, nature, reservationMode, sortOrder, active: true };
}

function allocation(id: string, budgetCycleId: string, categoryId: string, baseAmountMinor: number): BudgetAllocation {
  return { ...meta(id), budgetCycleId, categoryId, baseAmountMinor };
}

function plan(
  id: string,
  kind: PlanInstance["kind"],
  name: string,
  expectedDate: IsoDate,
  expectedAmountMinor: number,
  categoryId: string | undefined,
  confidence: PlanInstance["confidence"],
  options: Partial<PlanInstance> = {}
): PlanInstance {
  return {
    ...meta(id),
    kind,
    name,
    expectedDate,
    expectedAmountMinor,
    confidence,
    reservation: "reserved",
    status: "scheduled",
    categoryId,
    ...options
  };
}

function leg(id: string, transactionId: string, accountId: string, deltaMinor: number): TransactionLeg {
  return { ...meta(id), transactionId, accountId, deltaMinor };
}

function totalFor(events: Array<{ id: string; sourceId?: string; deltaMinor: number }>, idOrSource: string): number {
  return events
    .filter((event) => event.id.includes(idOrSource) || event.sourceId === idOrSource)
    .reduce((total, event) => total + event.deltaMinor, 0);
}

function eventsForSource(events: Array<{ sourceId?: string }>, sourceId: string): Array<{ sourceId?: string }> {
  return events.filter((event) => event.sourceId === sourceId);
}
