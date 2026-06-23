import { buildBudgetProgressRows } from "../budgets/budgetProgress";
import { addDays, daysBetweenInclusive, isOnOrBefore, isWithinInclusive } from "../dates";
import { calculateCategoryActuals } from "../transactions/calculations";
import type {
  BluehourSnapshot,
  BudgetCycle,
  CoachInsightDecision,
  IsoDate,
  Subscription,
  Transaction,
  TransactionSplit
} from "../types";
import { isActive } from "../types";
import { subscriptionCostSummary } from "../subscriptions/subscriptionCost";
import type { SavingsCoachPreferences } from "./preferences";

export type SpendingInsightKind =
  | "category_pacing"
  | "cycle_increase"
  | "small_purchase_cluster"
  | "merchant_concentration"
  | "watchlist_merchant"
  | "subscription_review"
  | "new_recurring_cost"
  | "extra_income_spendthrough";

export interface SpendingInsight {
  fingerprint: string;
  kind: SpendingInsightKind;
  level: "notice" | "watch" | "action";
  title: string;
  description: string;
  potentialSavingMinor: number;
  categoryId?: string;
  merchant?: string;
  subscriptionId?: string;
  recurringRuleId?: string;
  dueDate?: IsoDate;
}

interface ExpenseSplit {
  transaction: Transaction;
  split: TransactionSplit;
  categoryName: string;
  amountMinor: number;
}

interface SensitivityThresholds {
  minimumPotentialMinor: number;
  categoryIncreaseBasisPoints: number;
  smallPurchaseCount: number;
}

export function detectSpendingLeaks(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  preferences: SavingsCoachPreferences
): SpendingInsight[] {
  if (!preferences.enabled) {
    return [];
  }

  const currentEnd = minIsoDate(asOfDate, addDays(cycle.expectedNextSalaryTo, -1));
  const thresholds = thresholdsForSensitivity(preferences.insightSensitivity);
  const insights: SpendingInsight[] = [
    ...categoryPacingInsights(snapshot, cycle, currentEnd, thresholds),
    ...cycleIncreaseInsights(snapshot, cycle, currentEnd, thresholds),
    ...smallPurchaseInsights(snapshot, cycle, currentEnd, preferences, thresholds),
    ...merchantInsights(snapshot, cycle, currentEnd, preferences, thresholds),
    ...subscriptionInsights(snapshot, currentEnd),
    ...newRecurringCostInsights(snapshot, cycle, currentEnd, thresholds),
    ...extraIncomeSpendthroughInsights(snapshot, cycle, currentEnd, thresholds)
  ];

  return rankInsights(filterDecidedInsights(dedupeInsights(insights), snapshot.coachInsightDecisions, asOfDate)).slice(0, 8);
}

function categoryPacingInsights(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  thresholds: SensitivityThresholds
): SpendingInsight[] {
  const elapsedDays = daysBetweenInclusive(cycle.startedOn, asOfDate);
  const cycleDays = daysBetweenInclusive(cycle.startedOn, addDays(cycle.expectedNextSalaryTo, -1));
  return buildBudgetProgressRows({ snapshot, cycle, asOfDate })
    .filter((row) => row.allocationMinor > 0 && row.spentMinor > 0 && (row.state === "near_limit" || row.state === "overspent"))
    .flatMap((row) => {
      const expectedByToday = Math.floor((row.allocationMinor * elapsedDays + Math.floor(cycleDays / 2)) / cycleDays);
      const paceGapMinor = row.spentMinor - expectedByToday;
      if (paceGapMinor < thresholds.minimumPotentialMinor) {
        return [];
      }
      return [
        {
          fingerprint: `category-pacing:${cycle.id}:${row.categoryId}`,
          kind: "category_pacing",
          level: row.state === "overspent" ? "action" : "watch",
          title: `${row.categoryName} is running ahead`,
          description: `${row.categoryName} has used or reserved ${row.percentageUsedOrReserved}% of its allocation for this salary cycle.`,
          potentialSavingMinor: paceGapMinor,
          categoryId: row.categoryId
        } satisfies SpendingInsight
      ];
    });
}

function cycleIncreaseInsights(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  thresholds: SensitivityThresholds
): SpendingInsight[] {
  const previousCycle = mostRecentCompletedCycle(snapshot.budgetCycles, cycle.startedOn);
  if (!previousCycle) {
    return [];
  }

  const elapsedDays = daysBetweenInclusive(cycle.startedOn, asOfDate);
  const previousEnd = minIsoDate(addDays(previousCycle.startedOn, elapsedDays - 1), previousCycle.endedOn ?? addDays(previousCycle.expectedNextSalaryTo, -1));
  return snapshot.categories
    .filter((category) => isActive(category) && category.active && category.nature !== "administrative" && category.nature !== "protected")
    .flatMap((category) => {
      const current = calculateCategoryActuals(category.id, snapshot.transactions, snapshot.transactionSplits, cycle.startedOn, asOfDate);
      const previous = calculateCategoryActuals(category.id, snapshot.transactions, snapshot.transactionSplits, previousCycle.startedOn, previousEnd);
      const delta = current - previous;
      if (delta < thresholds.minimumPotentialMinor) {
        return [];
      }
      const increaseBasisPoints = previous > 0 ? Math.floor((delta * 10_000 + Math.floor(previous / 2)) / previous) : 10_000;
      if (increaseBasisPoints < thresholds.categoryIncreaseBasisPoints) {
        return [];
      }
      return [
        {
          fingerprint: `cycle-increase:${cycle.id}:${category.id}`,
          kind: "cycle_increase",
          level: increaseBasisPoints >= 5_000 ? "action" : "watch",
          title: `${category.name} is higher than last cycle`,
          description: `${category.name} spending is above the previous completed cycle at the same elapsed point.`,
          potentialSavingMinor: delta,
          categoryId: category.id
        } satisfies SpendingInsight
      ];
    });
}

function smallPurchaseInsights(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  preferences: SavingsCoachPreferences,
  thresholds: SensitivityThresholds
): SpendingInsight[] {
  const windowStart = maxIsoDate(cycle.startedOn, addDays(asOfDate, -(preferences.smallPurchaseWindowDays - 1)));
  const smallPurchases = expenseSplits(snapshot, windowStart, asOfDate).filter((expense) => expense.amountMinor <= preferences.smallPurchaseThresholdMinor);
  const byCategory = groupBy(smallPurchases, (expense) => expense.split.categoryId);
  return [...byCategory.entries()].flatMap(([categoryId, expenses]) => {
    const totalMinor = expenses.reduce((total, expense) => total + expense.amountMinor, 0);
    if (expenses.length < thresholds.smallPurchaseCount || totalMinor < thresholds.minimumPotentialMinor) {
      return [];
    }
    const categoryName = expenses[0]?.categoryName ?? "Small purchases";
    return [
      {
        fingerprint: `small-purchases:${cycle.id}:${categoryId}:${windowStart}:${asOfDate}`,
        kind: "small_purchase_cluster",
        level: totalMinor >= preferences.smallPurchaseThresholdMinor * (thresholds.smallPurchaseCount + 1) ? "watch" : "notice",
        title: `${categoryName} has repeated small purchases`,
        description: `${expenses.length} purchases under the configured small-purchase threshold landed in the current watch window.`,
        potentialSavingMinor: roundDivide(totalMinor, 2),
        categoryId
      } satisfies SpendingInsight
    ];
  });
}

function merchantInsights(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  preferences: SavingsCoachPreferences,
  thresholds: SensitivityThresholds
): SpendingInsight[] {
  const watchTerms = preferences.merchantWatchlist.map((term) => term.trim().toLowerCase()).filter(Boolean);
  const expenses = expenseSplits(snapshot, cycle.startedOn, asOfDate);
  const byMerchant = groupBy(expenses, (expense) => merchantLabel(expense.transaction));
  const concentration = [...byMerchant.entries()].flatMap(([merchant, merchantExpenses]) => {
    const totalMinor = merchantExpenses.reduce((total, expense) => total + expense.amountMinor, 0);
    if (merchantExpenses.length < 2 || totalMinor < thresholds.minimumPotentialMinor * 2) {
      return [];
    }
    return [
      {
        fingerprint: `merchant-concentration:${cycle.id}:${merchant.toLowerCase()}`,
        kind: "merchant_concentration",
        level: totalMinor >= thresholds.minimumPotentialMinor * 4 ? "watch" : "notice",
        title: `${merchant} is a visible spending cluster`,
        description: `${merchantExpenses.length} expenses in this salary cycle are grouped under the same merchant.`,
        potentialSavingMinor: roundDivide(totalMinor, 4),
        merchant
      } satisfies SpendingInsight
    ];
  });
  const watchlist = [...byMerchant.entries()].flatMap(([merchant, merchantExpenses]) => {
    if (!watchTerms.some((term) => merchant.toLowerCase().includes(term))) {
      return [];
    }
    const totalMinor = merchantExpenses.reduce((total, expense) => total + expense.amountMinor, 0);
    return [
      {
        fingerprint: `watchlist-merchant:${cycle.id}:${merchant.toLowerCase()}`,
        kind: "watchlist_merchant",
        level: "watch",
        title: `${merchant} matched the watchlist`,
        description: "A merchant on the Savings Coach watchlist appeared in this salary cycle.",
        potentialSavingMinor: totalMinor,
        merchant
      } satisfies SpendingInsight
    ];
  });
  return [...concentration, ...watchlist];
}

function subscriptionInsights(snapshot: BluehourSnapshot, asOfDate: IsoDate): SpendingInsight[] {
  const ruleById = new Map(snapshot.recurringRules.filter(isActive).map((rule) => [rule.id, rule]));
  return snapshot.subscriptions.filter((subscription) => isReviewableSubscription(subscription)).flatMap((subscription) => {
    const rule = ruleById.get(subscription.recurringRuleId);
    if (!rule) {
      return [];
    }
    const cost = subscriptionCostSummary(rule.amountMinor, subscription.billingFrequency);
    const reviewReason = subscriptionReviewReason(subscription, asOfDate);
    if (!reviewReason) {
      return [];
    }
    return [
      {
        fingerprint: `subscription-review:${subscription.id}:${reviewReason.key}`,
        kind: "subscription_review",
        level: subscription.valueRating === "rarely_used" ? "action" : "watch",
        title: `Review ${subscription.provider}`,
        description: reviewReason.description,
        potentialSavingMinor: subscription.valueRating === "rarely_used" ? cost.annualMinor : cost.monthlyMinor,
        subscriptionId: subscription.id,
        recurringRuleId: rule.id,
        dueDate: subscription.cancellationDeadline ?? subscription.annualRenewalDate ?? subscription.nextPaymentDate
      } satisfies SpendingInsight
    ];
  });
}

function newRecurringCostInsights(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  thresholds: SensitivityThresholds
): SpendingInsight[] {
  return snapshot.recurringRules
    .filter(
      (rule) =>
        isActive(rule) &&
        rule.active &&
        rule.kind !== "income" &&
        isWithinInclusive(rule.startDate, cycle.startedOn, asOfDate) &&
        rule.amountMinor >= thresholds.minimumPotentialMinor
    )
    .map((rule) => ({
      fingerprint: `new-recurring:${cycle.id}:${rule.id}`,
      kind: "new_recurring_cost",
      level: rule.amountMinor >= thresholds.minimumPotentialMinor * 4 ? "watch" : "notice",
      title: `${rule.name} is a new recurring cost`,
      description: "This recurring item starts inside the current salary cycle.",
      potentialSavingMinor: rule.amountMinor,
      recurringRuleId: rule.id
    }));
}

function extraIncomeSpendthroughInsights(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  thresholds: SensitivityThresholds
): SpendingInsight[] {
  const categories = new Map(snapshot.categories.map((category) => [category.id, category]));
  return snapshot.extraIncomeAllocations
    .filter(
      (allocation) =>
        isActive(allocation) &&
        allocation.availableMinor >= thresholds.minimumPotentialMinor &&
        (!allocation.budgetCycleId || allocation.budgetCycleId === cycle.id)
    )
    .flatMap((allocation) => {
      const income = snapshot.transactions.find((transaction) => transaction.id === allocation.incomeTransactionId && isActive(transaction));
      if (!income || !isWithinInclusive(income.occurredOn, cycle.startedOn, asOfDate)) {
        return [];
      }
      const discretionarySpendAfterIncome = expenseSplits(snapshot, income.occurredOn, asOfDate)
        .filter((expense) => categories.get(expense.split.categoryId)?.nature === "discretionary")
        .reduce((total, expense) => total + expense.amountMinor, 0);
      if (discretionarySpendAfterIncome < roundDivide(allocation.availableMinor, 2)) {
        return [];
      }
      return [
        {
          fingerprint: `extra-income-spendthrough:${cycle.id}:${allocation.id}`,
          kind: "extra_income_spendthrough",
          level: "watch",
          title: "Extra income is flowing back into discretionary spend",
          description: "Discretionary spending after this extra-income entry is high enough to review before the cycle closes.",
          potentialSavingMinor: Math.min(discretionarySpendAfterIncome, allocation.availableMinor)
        } satisfies SpendingInsight
      ];
    });
}

function expenseSplits(snapshot: BluehourSnapshot, startDate: IsoDate, endDate: IsoDate): ExpenseSplit[] {
  const transactionById = new Map(snapshot.transactions.filter(isActive).map((transaction) => [transaction.id, transaction]));
  const categoryById = new Map(snapshot.categories.filter(isActive).map((category) => [category.id, category]));
  return snapshot.transactionSplits
    .filter((split) => isActive(split) && (split.direction === "expense" || split.direction === "reversal"))
    .flatMap((split) => {
      const transaction = transactionById.get(split.transactionId);
      const category = categoryById.get(split.categoryId);
      if (!transaction || transaction.type === "transfer" || !isWithinInclusive(transaction.occurredOn, startDate, endDate)) {
        return [];
      }
      const amountMinor = split.direction === "reversal" ? -split.amountMinor : split.amountMinor;
      if (amountMinor <= 0) {
        return [];
      }
      return [{ transaction, split, categoryName: category?.name ?? "Uncategorised", amountMinor }];
    });
}

function isReviewableSubscription(subscription: Subscription): boolean {
  return isActive(subscription) && (subscription.status ?? "active") !== "archived" && (subscription.status ?? "active") !== "paused";
}

function subscriptionReviewReason(subscription: Subscription, asOfDate: IsoDate): { key: string; description: string } | null {
  if (subscription.valueRating === "rarely_used" || subscription.valueRating === "maybe") {
    return { key: subscription.valueRating, description: "The value rating marks this subscription as optional enough to review before the next renewal." };
  }
  if (subscription.cancellationDeadline && isOnOrBefore(subscription.cancellationDeadline, addDays(asOfDate, 30))) {
    return { key: "cancellation-deadline", description: "The cancellation deadline is within the next 30 days." };
  }
  if (subscription.annualRenewalDate && isOnOrBefore(subscription.annualRenewalDate, addDays(asOfDate, 30))) {
    return { key: "annual-renewal", description: "The annual renewal date is within the next 30 days." };
  }
  return null;
}

function filterDecidedInsights(
  insights: readonly SpendingInsight[],
  decisions: readonly CoachInsightDecision[],
  asOfDate: IsoDate
): SpendingInsight[] {
  const activeDecisions = decisions.filter(isActive);
  return insights.filter((insight) => {
    const decision = activeDecisions
      .filter((item) => item.insightFingerprint === insight.fingerprint)
      .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0];
    if (!decision) {
      return true;
    }
    if (decision.decision === "snoozed") {
      return !decision.snoozedUntil || decision.snoozedUntil < asOfDate;
    }
    return false;
  });
}

function dedupeInsights(insights: readonly SpendingInsight[]): SpendingInsight[] {
  const byFingerprint = new Map<string, SpendingInsight>();
  for (const insight of insights) {
    const existing = byFingerprint.get(insight.fingerprint);
    if (!existing || insight.potentialSavingMinor > existing.potentialSavingMinor) {
      byFingerprint.set(insight.fingerprint, insight);
    }
  }
  return [...byFingerprint.values()];
}

function rankInsights(insights: readonly SpendingInsight[]): SpendingInsight[] {
  const levelRank = { action: 0, watch: 1, notice: 2 } as const;
  return [...insights].sort(
    (left, right) =>
      levelRank[left.level] - levelRank[right.level] ||
      right.potentialSavingMinor - left.potentialSavingMinor ||
      left.kind.localeCompare(right.kind) ||
      left.title.localeCompare(right.title)
  );
}

function mostRecentCompletedCycle(cycles: readonly BudgetCycle[], beforeDate: IsoDate): BudgetCycle | undefined {
  return cycles
    .filter((cycle) => isActive(cycle) && cycle.status === "closed" && cycle.startedOn < beforeDate)
    .sort((left, right) => right.startedOn.localeCompare(left.startedOn))[0];
}

function thresholdsForSensitivity(sensitivity: SavingsCoachPreferences["insightSensitivity"]): SensitivityThresholds {
  if (sensitivity === "gentle") {
    return { minimumPotentialMinor: 5_000, categoryIncreaseBasisPoints: 3_500, smallPurchaseCount: 5 };
  }
  if (sensitivity === "strict") {
    return { minimumPotentialMinor: 1_000, categoryIncreaseBasisPoints: 1_500, smallPurchaseCount: 3 };
  }
  return { minimumPotentialMinor: 2_500, categoryIncreaseBasisPoints: 2_500, smallPurchaseCount: 4 };
}

function groupBy<T>(values: readonly T[], keyFor: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return grouped;
}

function merchantLabel(transaction: Transaction): string {
  return transaction.merchantNormalized || transaction.description.trim() || "Unknown merchant";
}

function roundDivide(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function minIsoDate(left: IsoDate, right: IsoDate): IsoDate {
  return left <= right ? left : right;
}

function maxIsoDate(left: IsoDate, right: IsoDate): IsoDate {
  return left >= right ? left : right;
}
