import { addDays, daysBetweenInclusive, isOnOrBefore } from "../dates";
import { calculateCompletedProtectedTransfers } from "../forecasting/protectedProgress";
import { calculateCategoryActuals } from "../transactions/calculations";
import type { BluehourSnapshot, BudgetCycle, IsoDate, TransactionSplit } from "../types";
import { isActive } from "../types";

export interface CycleComparisonItem {
  id: string;
  kind:
    | "category_spending"
    | "total_spending"
    | "plan_variance"
    | "subscription_change"
    | "recurring_change"
    | "protected_progress"
    | "budget_status";
  label: string;
  currentMinor?: number;
  previousMinor?: number;
  deltaMinor?: number;
  percentageBasisPoints?: number;
  explanation: string;
  level: "info" | "positive" | "warning" | "danger";
}

export interface CycleComparisonResult {
  items: CycleComparisonItem[];
  unavailableReason?: string;
}

export function compareActiveCycleToPrevious(snapshot: BluehourSnapshot, activeCycle: BudgetCycle, asOfDate: IsoDate): CycleComparisonResult {
  const previousCycle = mostRecentCompletedCycle(snapshot.budgetCycles, activeCycle.startedOn);
  if (!previousCycle) {
    return { items: [], unavailableReason: "Cycle comparison will be available after another completed cycle." };
  }

  const elapsedDays = daysBetweenInclusive(activeCycle.startedOn, asOfDate);
  const previousEnd = minIsoDate(addDays(previousCycle.startedOn, elapsedDays - 1), previousCycle.endedOn ?? addDays(previousCycle.expectedNextSalaryTo, -1));
  const currentEnd = minIsoDate(asOfDate, addDays(activeCycle.expectedNextSalaryTo, -1));
  const items: CycleComparisonItem[] = [];

  const currentTotal = totalSpending(snapshot, activeCycle.startedOn, currentEnd);
  const previousTotal = totalSpending(snapshot, previousCycle.startedOn, previousEnd);
  if (currentTotal !== previousTotal) {
    items.push(moneyDeltaItem("total-spending", "total_spending", "Total spending", currentTotal, previousTotal, "Total actual spending at the same elapsed point in the salary cycle."));
  }

  const categories = snapshot.categories.filter((category) => isActive(category) && category.nature !== "administrative");
  for (const category of categories) {
    const current = calculateCategoryActuals(category.id, snapshot.transactions, snapshot.transactionSplits, activeCycle.startedOn, currentEnd);
    const previous = calculateCategoryActuals(category.id, snapshot.transactions, snapshot.transactionSplits, previousCycle.startedOn, previousEnd);
    const delta = current - previous;
    if (Math.abs(delta) < 100) {
      continue;
    }
    items.push(
      moneyDeltaItem(
        `category-${category.id}`,
        "category_spending",
        category.name,
        current,
        previous,
        `${category.name} spending compared with the previous completed cycle through day ${daysBetweenInclusive(previousCycle.startedOn, previousEnd)}.`
      )
    );
  }

  items.push(...planVarianceItems(snapshot, activeCycle.startedOn, currentEnd));
  items.push(...subscriptionChangeItems(snapshot, activeCycle.startedOn, currentEnd));
  items.push(...recurringChangeItems(snapshot, activeCycle.startedOn, currentEnd, previousCycle.startedOn, previousEnd));

  const currentProtected = calculateCompletedProtectedTransfers(snapshot, activeCycle, currentEnd);
  const previousProtected = calculateCompletedProtectedTransfers(snapshot, previousCycle, previousEnd);
  if (currentProtected !== previousProtected) {
    items.push(
      moneyDeltaItem(
        "protected-progress",
        "protected_progress",
        "Protected contribution progress",
        currentProtected,
        previousProtected,
        "Protected transfer progress compared with the previous completed cycle at the same elapsed point."
      )
    );
  }

  return { items: rankItems(items).slice(0, 10) };
}

function mostRecentCompletedCycle(cycles: readonly BudgetCycle[], beforeDate: IsoDate): BudgetCycle | undefined {
  return cycles
    .filter((cycle) => isActive(cycle) && cycle.status === "closed" && cycle.startedOn < beforeDate)
    .sort((left, right) => right.startedOn.localeCompare(left.startedOn))[0];
}

function totalSpending(snapshot: BluehourSnapshot, startDate: IsoDate, endDate: IsoDate): number {
  const transactionById = new Map(snapshot.transactions.filter(isActive).map((transaction) => [transaction.id, transaction]));
  return snapshot.transactionSplits
    .filter((split) => isActive(split) && isSpendingSplit(split))
    .reduce((total, split) => {
      const transaction = transactionById.get(split.transactionId);
      if (!transaction || transaction.type === "transfer" || !isWithinWindow(transaction.occurredOn, startDate, endDate)) {
        return total;
      }
      return total + (split.direction === "reversal" ? -split.amountMinor : split.amountMinor);
    }, 0);
}

function planVarianceItems(snapshot: BluehourSnapshot, startDate: IsoDate, endDate: IsoDate): CycleComparisonItem[] {
  return snapshot.planInstances
    .filter((plan) => isActive(plan) && plan.status === "fulfilled" && plan.linkedTransactionId && isWithinWindow(plan.expectedDate, startDate, endDate))
    .flatMap((plan) => {
      const actual = transactionAmount(plan.linkedTransactionId!, snapshot.transactionSplits);
      const delta = actual - plan.expectedAmountMinor;
      if (Math.abs(delta) < 100) {
        return [];
      }
      return [
        moneyDeltaItem(
          `plan-variance-${plan.id}`,
          "plan_variance",
          `${plan.name} variance`,
          actual,
          plan.expectedAmountMinor,
          "Actual payment amount compared with the fulfilled plan amount."
        )
      ];
    });
}

function subscriptionChangeItems(snapshot: BluehourSnapshot, startDate: IsoDate, endDate: IsoDate): CycleComparisonItem[] {
  return snapshot.subscriptions.filter(isActive).flatMap((subscription) => {
    const history = parsePriceHistory(subscription.priceHistoryJson);
    return history
      .filter((entry) => isWithinWindow(entry.effectiveDate, startDate, endDate))
      .map((entry) =>
        moneyDeltaItem(
          `subscription-${subscription.id}-${entry.changedAt}`,
          "subscription_change",
          `${subscription.provider} price changed`,
          entry.nextAmountMinor,
          entry.previousAmountMinor,
          "Subscription price history recorded a changed billing amount."
        )
      );
  });
}

function recurringChangeItems(
  snapshot: BluehourSnapshot,
  currentStart: IsoDate,
  currentEnd: IsoDate,
  previousStart: IsoDate,
  previousEnd: IsoDate
): CycleComparisonItem[] {
  const current = snapshot.recurringRules.filter((rule) => isActive(rule) && rule.active && isOnOrBefore(rule.startDate, currentEnd));
  const previous = snapshot.recurringRules.filter((rule) => isActive(rule) && rule.active && isOnOrBefore(rule.startDate, previousEnd));
  const previousNames = new Set(previous.map((rule) => rule.name.toLowerCase()));
  const currentNames = new Set(current.map((rule) => rule.name.toLowerCase()));
  const additions = current.filter((rule) => !previousNames.has(rule.name.toLowerCase()) && isWithinWindow(rule.startDate, currentStart, currentEnd));
  const removals = previous.filter((rule) => !currentNames.has(rule.name.toLowerCase()) && isWithinWindow(rule.startDate, previousStart, previousEnd));

  return [
    ...additions.map((rule): CycleComparisonItem => ({
      id: `recurring-new-${rule.id}`,
      kind: "recurring_change",
      label: `New recurring item: ${rule.name}`,
      currentMinor: rule.amountMinor,
      deltaMinor: rule.amountMinor,
      explanation: "A recurring rule starts in the current comparison window.",
      level: rule.kind === "income" ? "positive" : "warning"
    })),
    ...removals.map((rule): CycleComparisonItem => ({
      id: `recurring-removed-${rule.id}`,
      kind: "recurring_change",
      label: `Removed recurring item: ${rule.name}`,
      previousMinor: rule.amountMinor,
      deltaMinor: -rule.amountMinor,
      explanation: "A recurring rule from the previous comparison window is no longer active by name.",
      level: rule.kind === "income" ? "warning" : "positive"
    }))
  ];
}

function moneyDeltaItem(
  id: string,
  kind: CycleComparisonItem["kind"],
  label: string,
  currentMinor: number,
  previousMinor: number,
  explanation: string
): CycleComparisonItem {
  const deltaMinor = currentMinor - previousMinor;
  return {
    id,
    kind,
    label,
    currentMinor,
    previousMinor,
    deltaMinor,
    percentageBasisPoints: previousMinor > 0 ? Math.floor((Math.abs(deltaMinor) * 10_000 + Math.floor(previousMinor / 2)) / previousMinor) : undefined,
    explanation,
    level: levelForDelta(kind, deltaMinor)
  };
}

function levelForDelta(kind: CycleComparisonItem["kind"], deltaMinor: number): CycleComparisonItem["level"] {
  if (deltaMinor === 0) {
    return "info";
  }
  if (kind === "protected_progress") {
    return deltaMinor > 0 ? "positive" : "warning";
  }
  if (kind === "subscription_change" || kind === "recurring_change" || kind === "plan_variance" || kind === "category_spending" || kind === "total_spending") {
    return deltaMinor > 0 ? "warning" : "positive";
  }
  return "info";
}

function rankItems(items: readonly CycleComparisonItem[]): CycleComparisonItem[] {
  return [...items].sort((left, right) => {
    const impact = Math.abs(right.deltaMinor ?? 0) - Math.abs(left.deltaMinor ?? 0);
    return impact || left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
  });
}

function transactionAmount(transactionId: string, splits: readonly TransactionSplit[]): number {
  return splits
    .filter((split) => isActive(split) && split.transactionId === transactionId && isSpendingSplit(split))
    .reduce((total, split) => total + (split.direction === "reversal" ? -split.amountMinor : split.amountMinor), 0);
}

function parsePriceHistory(value: string | undefined): Array<{ changedAt: string; effectiveDate: IsoDate; previousAmountMinor: number; nextAmountMinor: number }> {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as Array<{ changedAt: string; effectiveDate: IsoDate; previousAmountMinor: number; nextAmountMinor: number }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isSpendingSplit(split: TransactionSplit): boolean {
  return split.direction === "expense" || split.direction === "reversal";
}

function isWithinWindow(date: IsoDate, startDate: IsoDate, endDate: IsoDate): boolean {
  return date >= startDate && date <= endDate;
}

function minIsoDate(left: IsoDate, right: IsoDate): IsoDate {
  return left <= right ? left : right;
}
