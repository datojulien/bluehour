import { describe, expect, it } from "vitest";
import {
  basisPointsOf,
  buildCommitmentsForCycle,
  buildHistoricalCategoryActuals,
  medianMinor,
  recommendBudget,
  recommendationTotal,
  type BudgetCoachInput,
  type HistoricalCategoryActual
} from "./budgetCoach";
import type { BudgetCycle, Category, PlanInstance, RecurringRule, Transaction, TransactionSplit } from "../types";

const now = "2026-07-01T00:00:00.000Z";

function meta(id: string) {
  return { id, createdAt: now, updatedAt: now, archivedAt: null, revision: 1 };
}

function baseInput(overrides: Partial<BudgetCoachInput> = {}): BudgetCoachInput {
  return {
    salaryMinor: 500_000,
    profileId: "balanced",
    configuredMinimumProtectedRateBasisPoints: 1_000,
    bufferMinimumMinor: 50_000,
    bufferEssentialRateBasisPoints: 1_000,
    commitments: [
      { id: "rent", label: "Rent", amountMinor: 100_000, source: "manual" },
      { id: "utilities", label: "Utilities", amountMinor: 20_000, source: "manual" }
    ],
    essentialPreferences: [
      { categoryId: "cat-groceries", minimumMinor: 45_000, comfortableMinor: 60_000, priority: "high" },
      { categoryId: "cat-fuel", minimumMinor: 25_000, comfortableMinor: 30_000, priority: "normal" }
    ],
    discretionaryPreferences: [
      { categoryId: "cat-dining", enabled: true, priority: "normal" },
      { categoryId: "cat-shopping", enabled: true, priority: "low" }
    ],
    ...overrides
  };
}

function category(id: string, group: Category["group"], nature: Category["nature"], reservationMode: Category["reservationMode"]): Category {
  return {
    ...meta(id),
    name: id,
    group,
    nature,
    reservationMode,
    sortOrder: 1,
    active: true
  };
}

function plan(
  id: string,
  kind: PlanInstance["kind"],
  expectedDate: PlanInstance["expectedDate"],
  expectedAmountMinor: number,
  categoryId: string,
  recurringRuleId?: string
): PlanInstance {
  return {
    ...meta(id),
    recurringRuleId,
    kind,
    name: id,
    expectedDate,
    expectedAmountMinor,
    confidence: "expected",
    reservation: "reserved",
    status: "scheduled",
    categoryId
  };
}

describe("Budget Coach recommendation engine", () => {
  it("recommends a balanced profile with sufficient income", () => {
    const result = recommendBudget(baseInput());

    expect(result.feasible).toBe(true);
    expect(result.protectedTargetMinor).toBe(75_000);
    expect(result.bufferMinor).toBe(50_000);
    expect(result.essentialSuggestedMinor).toBe(90_000);
    expect(result.discretionaryMinor).toBe(165_000);
    expect(result.shortfallMinor).toBe(0);
  });

  it("uses the configured minimum protected rate for flexible when it is above 10%", () => {
    const result = recommendBudget(
      baseInput({
        profileId: "flexible",
        configuredMinimumProtectedRateBasisPoints: 1_200
      })
    );

    expect(result.protectedTargetMinor).toBe(60_000);
    expect(result.protectedRateBasisPoints).toBe(1_200);
  });

  it("uses the secure 20% target when affordable", () => {
    const result = recommendBudget(baseInput({ profileId: "secure" }));

    expect(result.protectedTargetMinor).toBe(100_000);
    expect(result.protectedRateBasisPoints).toBe(2_000);
    expect(result.feasible).toBe(true);
  });

  it("honours a configured protected minimum above the profile target", () => {
    const result = recommendBudget(
      baseInput({
        profileId: "balanced",
        configuredMinimumProtectedRateBasisPoints: 1_800
      })
    );

    expect(result.protectedTargetMinor).toBe(90_000);
  });

  it("adjusts a selected profile down toward the configured minimum when only that range fits", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 270_000,
        commitments: [{ id: "rent", label: "Rent", amountMinor: 100_000, source: "manual" }],
        essentialPreferences: [{ categoryId: "cat-groceries", minimumMinor: 80_000, comfortableMinor: 80_000, priority: "normal" }],
        discretionaryPreferences: []
      })
    );

    expect(result.protectedTargetMinor).toBe(40_000);
    expect(result.protectedTargetMinor).toBeGreaterThan(27_000);
    expect(result.protectedTargetMinor).toBeLessThan(40_500);
    expect(result.explanations.join(" ")).toContain("adjusted");
  });

  it("keeps the minimum protected target and reports a shortfall when even the minimum is unaffordable", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 250_000,
        commitments: [{ id: "rent", label: "Rent", amountMinor: 100_000, source: "manual" }],
        essentialPreferences: [{ categoryId: "cat-groceries", minimumMinor: 80_000, comfortableMinor: 80_000, priority: "normal" }],
        discretionaryPreferences: []
      })
    );

    expect(result.protectedTargetMinor).toBe(25_000);
    expect(result.feasible).toBe(false);
    expect(result.shortfallMinor).toBe(5_000);
    expect(result.discretionaryMinor).toBe(0);
  });

  it("detects when fixed commitments exceed salary", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 100_000,
        commitments: [{ id: "rent", label: "Rent", amountMinor: 150_000, source: "manual" }],
        essentialPreferences: [],
        discretionaryPreferences: []
      })
    );

    expect(result.feasible).toBe(false);
    expect(result.shortfallMinor).toBeGreaterThan(0);
  });

  it("detects when essential minimums create a shortfall", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 200_000,
        commitments: [{ id: "rent", label: "Rent", amountMinor: 50_000, source: "manual" }],
        essentialPreferences: [{ categoryId: "cat-medical", minimumMinor: 120_000, comfortableMinor: 120_000, priority: "high" }],
        discretionaryPreferences: []
      })
    );

    expect(result.feasible).toBe(false);
    expect(result.shortfallMinor).toBe(40_000);
  });

  it("does not exceed comfortable amounts without history", () => {
    const result = recommendBudget(baseInput({ salaryMinor: 900_000 }));

    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-groceries")?.suggestedAmountMinor).toBe(60_000);
    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-fuel")?.suggestedAmountMinor).toBe(30_000);
  });

  it("does not reduce essential recommendations below minimums", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 150_000,
        commitments: [{ id: "rent", label: "Rent", amountMinor: 120_000, source: "manual" }],
        essentialPreferences: [{ categoryId: "cat-groceries", minimumMinor: 45_000, comfortableMinor: 60_000, priority: "high" }],
        discretionaryPreferences: []
      })
    );

    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-groceries")?.suggestedAmountMinor).toBe(45_000);
  });

  it("gives high-priority essential categories deterministic preference", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 115,
        profileId: "flexible",
        configuredMinimumProtectedRateBasisPoints: 0,
        bufferMinimumMinor: 0,
        commitments: [],
        essentialPreferences: [
          { categoryId: "cat-high", minimumMinor: 0, comfortableMinor: 100, priority: "high" },
          { categoryId: "cat-normal", minimumMinor: 0, comfortableMinor: 100, priority: "normal" }
        ],
        discretionaryPreferences: []
      })
    );

    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-high")?.suggestedAmountMinor).toBe(62);
    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-normal")?.suggestedAmountMinor).toBe(41);
  });

  it("distributes discretionary weights with integer-sen remainders", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 11_111,
        profileId: "flexible",
        configuredMinimumProtectedRateBasisPoints: 0,
        bufferMinimumMinor: 0,
        commitments: [],
        essentialPreferences: [],
        discretionaryPreferences: [
          { categoryId: "cat-low", enabled: true, priority: "low" },
          { categoryId: "cat-normal", enabled: true, priority: "normal" },
          { categoryId: "cat-high", enabled: true, priority: "high" }
        ]
      })
    );

    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-high")?.suggestedAmountMinor).toBe(5_001);
    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-normal")?.suggestedAmountMinor).toBe(3_333);
    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-low")?.suggestedAmountMinor).toBe(1_666);
  });

  it("gives disabled discretionary categories zero", () => {
    const result = recommendBudget(
      baseInput({
        discretionaryPreferences: [
          { categoryId: "cat-dining", enabled: false, priority: "high" },
          { categoryId: "cat-shopping", enabled: true, priority: "low" }
        ]
      })
    );

    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-dining")?.suggestedAmountMinor).toBe(0);
  });

  it("preserves the remainder as unallocated when no discretionary categories are enabled", () => {
    const result = recommendBudget(
      baseInput({
        discretionaryPreferences: [
          { categoryId: "cat-dining", enabled: false, priority: "normal" },
          { categoryId: "cat-shopping", enabled: false, priority: "low" }
        ]
      })
    );

    expect(result.discretionaryMinor).toBe(0);
    expect(result.unallocatedMinor).toBe(165_000);
  });

  it("excludes possible variable income from the base recommendation", () => {
    const withoutIncome = recommendBudget(baseInput());
    const withPossibleIncome = recommendBudget(
      baseInput({
        scenarioIncome: [{ id: "bonus", label: "Possible bonus", amountMinor: 200_000, confidence: "possible" }]
      })
    );

    expect(withPossibleIncome.discretionaryMinor).toBe(withoutIncome.discretionaryMinor);
    expect(withPossibleIncome.excludedScenarioIncome).toHaveLength(1);
  });

  it("shows confirmed variable income only as a separate scenario", () => {
    const result = recommendBudget(
      baseInput({
        scenarioIncome: [{ id: "freelance", label: "Confirmed freelance", amountMinor: 35_000, confidence: "confirmed" }]
      })
    );

    expect(result.salaryMinor).toBe(500_000);
    expect(result.explanations.join(" ")).toContain("separate allocation choice");
  });

  it("keeps the safety buffer reserved outside category recommendations", () => {
    const result = recommendBudget(baseInput());
    const categoryTotal = result.categoryRecommendations.reduce((total, item) => total + item.suggestedAmountMinor, 0);

    expect(result.bufferMinor).toBe(50_000);
    expect(categoryTotal).toBe(result.essentialSuggestedMinor + result.discretionaryMinor);
  });

  it("reconciles feasible group amounts exactly to salary", () => {
    const result = recommendBudget(baseInput());

    expect(recommendationTotal(result)).toBe(result.salaryMinor);
  });

  it("rounds salary percentages with documented integer basis-point arithmetic", () => {
    expect(basisPointsOf(333, 1)).toBe(30);

    const result = recommendBudget(baseInput());
    const groupBasisPoints = result.groupRecommendations.reduce((total, group) => total + group.salaryPercentageBasisPoints, 0);
    expect(Math.abs(groupBasisPoints - 10_000)).toBeLessThanOrEqual(2);
  });

  it("never produces negative category recommendations", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 1,
        configuredMinimumProtectedRateBasisPoints: 0,
        bufferMinimumMinor: 0,
        commitments: [],
        essentialPreferences: [{ categoryId: "cat-groceries", minimumMinor: 10, comfortableMinor: 20, priority: "high" }]
      })
    );

    expect(result.categoryRecommendations.every((item) => item.suggestedAmountMinor >= 0)).toBe(true);
  });

  it("does not double-count subscriptions already represented by plan instances", () => {
    const categories = [category("cat-subscriptions", "committed", "discretionary", "plan")];
    const rule: RecurringRule = {
      ...meta("rule-cloud"),
      name: "Cloud",
      kind: "subscription",
      frequency: "monthly",
      interval: 1,
      startDate: "2026-07-01",
      dayOfMonth: 15,
      amountMode: "fixed",
      amountMinor: 2_500,
      categoryId: "cat-subscriptions",
      essential: false,
      active: true
    };
    const commitments = buildCommitmentsForCycle({
      categories,
      recurringRules: [rule],
      subscriptions: [
        {
          ...meta("sub-cloud"),
          recurringRuleId: rule.id,
          provider: "Cloud",
          billingFrequency: "monthly",
          nextPaymentDate: "2026-07-15",
          essential: false
        }
      ],
      planInstances: [plan("plan-cloud", "expense", "2026-07-15", 2_500, "cat-subscriptions", rule.id)],
      startDate: "2026-07-01",
      endDate: "2026-07-31"
    });

    expect(commitments).toHaveLength(1);
    expect(commitments[0].source).toBe("plan");
  });

  it("does not treat protected transfers as committed expenses", () => {
    const commitments = buildCommitmentsForCycle({
      categories: [category("cat-savings", "protected", "protected", "protected")],
      recurringRules: [],
      subscriptions: [],
      planInstances: [plan("plan-savings-transfer", "transfer", "2026-07-10", 10_000, "cat-savings")],
      startDate: "2026-07-01",
      endDate: "2026-07-31"
    });

    expect(commitments).toEqual([]);
  });

  it("uses observed confidence with one completed cycle", () => {
    const result = recommendBudget(baseInput({ historicalCategoryActuals: history("cat-dining", [12_000]) }));

    expect(result.confidence).toBe("observed");
  });

  it("uses reliable confidence with three completed cycles", () => {
    const result = recommendBudget(baseInput({ historicalCategoryActuals: history("cat-dining", [12_000, 13_000, 14_000]) }));

    expect(result.confidence).toBe("reliable");
  });

  it("calculates odd historical medians", () => {
    expect(medianMinor([30_000, 10_000, 20_000])).toBe(20_000);
  });

  it("calculates even historical medians with integer-safe midpoint rounding", () => {
    expect(medianMinor([10_000, 20_001])).toBe(15_001);
  });

  it("keeps historical essential suggestions at or above the user minimum", () => {
    const result = recommendBudget(
      baseInput({
        historicalCategoryActuals: history("cat-groceries", [30_000, 32_000, 31_000])
      })
    );

    expect(result.categoryRecommendations.find((item) => item.categoryId === "cat-groceries")?.suggestedAmountMinor).toBeGreaterThanOrEqual(45_000);
  });

  it("scales historical discretionary suggestions to fit the available pool", () => {
    const result = recommendBudget(
      baseInput({
        salaryMinor: 100_000,
        configuredMinimumProtectedRateBasisPoints: 0,
        bufferMinimumMinor: 0,
        commitments: [],
        essentialPreferences: [],
        discretionaryPreferences: [
          { categoryId: "cat-dining", enabled: true, priority: "normal" },
          { categoryId: "cat-shopping", enabled: true, priority: "normal" }
        ],
        historicalCategoryActuals: [
          ...history("cat-dining", [10_000, 10_000, 10_000]),
          ...history("cat-shopping", [30_000, 30_000, 30_000])
        ]
      })
    );

    expect(result.discretionaryMinor).toBe(40_000);
    expect(result.unallocatedMinor).toBe(45_000);
  });

  it("uses refund-adjusted actuals for historical recommendations", () => {
    const cycle: BudgetCycle = {
      ...meta("cycle-closed"),
      startedOn: "2026-07-01",
      endedOn: "2026-07-31",
      status: "closed",
      salaryTransactionId: "txn-salary",
      expectedNextSalaryFrom: "2026-08-24",
      expectedNextSalaryTo: "2026-08-26",
      protectedRateBasisPoints: 1_000,
      bufferMinimumMinor: 50_000,
      bufferEssentialRateBasisPoints: 1_000,
      actualMainSalaryMinor: 500_000
    };
    const transactions: Transaction[] = [
      { ...meta("txn-shop"), type: "expense", status: "actual", occurredOn: "2026-07-05", description: "Shop", source: "manual" },
      {
        ...meta("txn-refund"),
        type: "refund",
        status: "actual",
        occurredOn: "2026-07-08",
        description: "Shop refund",
        source: "manual",
        refundOfTransactionId: "txn-shop"
      }
    ];
    const splits: TransactionSplit[] = [
      { ...meta("split-shop"), transactionId: "txn-shop", categoryId: "cat-shopping", direction: "expense", amountMinor: 10_000 },
      { ...meta("split-refund"), transactionId: "txn-refund", categoryId: "cat-shopping", direction: "reversal", amountMinor: 4_000 }
    ];

    const actuals = buildHistoricalCategoryActuals({
      cycles: [cycle],
      transactions,
      transactionSplits: splits,
      categories: [category("cat-shopping", "discretionary", "discretionary", "envelope")]
    });

    expect(actuals).toContainEqual(expect.objectContaining({ categoryId: "cat-shopping", amountMinor: 6_000 }));
  });
});

function history(categoryId: string, amounts: readonly number[]): HistoricalCategoryActual[] {
  return amounts.map((amountMinor, index) => ({
    categoryId,
    cycleId: `cycle-${index + 1}`,
    amountMinor
  }));
}
