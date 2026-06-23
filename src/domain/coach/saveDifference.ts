import { buildBudgetProgressRows } from "../budgets/budgetProgress";
import type { BluehourSnapshot, BudgetCycle, IsoDate, SavingsGoalContribution } from "../types";
import { savingsGoalContribution } from "./savingsGoals";

export type SaveDifferenceMode = "half" | "all" | "custom";

export interface SaveDifferenceOpportunity {
  categoryId: string;
  categoryName: string;
  remainingMinor: number;
  maximumMoveMinor: number;
  suggestedMoveMinor: number;
  reason: string;
}

export function detectSaveDifferenceOpportunities(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  safeToSpendMinor?: number
): SaveDifferenceOpportunity[] {
  const globalCap = safeToSpendMinor === undefined ? undefined : Math.max(0, safeToSpendMinor);
  let remainingGlobalCap = globalCap;
  return buildBudgetProgressRows({ snapshot, cycle, asOfDate })
    .filter(
      (row) =>
        row.category.nature === "discretionary" &&
        row.category.reservationMode === "envelope" &&
        row.remainingAfterFuturePlansMinor > 0 &&
        row.percentageUsedOrReserved <= 75
    )
    .sort((left, right) => right.remainingAfterFuturePlansMinor - left.remainingAfterFuturePlansMinor || left.categoryName.localeCompare(right.categoryName))
    .flatMap((row) => {
      if (remainingGlobalCap !== undefined && remainingGlobalCap <= 0) {
        return [];
      }
      const keepInCategoryMinor = Math.min(row.remainingAfterFuturePlansMinor, Math.max(1_000, roundDivide(row.allocationMinor, 10)));
      const availableMinor = Math.max(0, row.remainingAfterFuturePlansMinor - keepInCategoryMinor);
      const maximumMoveMinor = remainingGlobalCap === undefined ? availableMinor : Math.min(availableMinor, remainingGlobalCap);
      if (maximumMoveMinor <= 0) {
        return [];
      }
      const suggestedMoveMinor = Math.max(0, roundDivide(maximumMoveMinor, 2));
      if (remainingGlobalCap !== undefined) {
        remainingGlobalCap -= suggestedMoveMinor;
      }
      return [
        {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          remainingMinor: row.remainingAfterFuturePlansMinor,
          maximumMoveMinor,
          suggestedMoveMinor,
          reason: `${row.categoryName} is under pace after reserved plans, so part of the remaining allocation can be protected.`
        } satisfies SaveDifferenceOpportunity
      ];
    })
    .filter((opportunity) => opportunity.suggestedMoveMinor > 0)
    .slice(0, 6);
}

export function saveDifferenceAmount(opportunity: SaveDifferenceOpportunity, mode: SaveDifferenceMode, customMinor = 0): number {
  if (mode === "all") {
    return opportunity.maximumMoveMinor;
  }
  if (mode === "custom") {
    return Math.min(opportunity.maximumMoveMinor, Math.max(0, customMinor));
  }
  return Math.min(opportunity.maximumMoveMinor, roundDivide(opportunity.maximumMoveMinor, 2));
}

export function createSaveDifferenceContribution({
  goalId,
  opportunity,
  amountMinor,
  occurredOn,
  budgetCycleId
}: {
  goalId: string;
  opportunity: SaveDifferenceOpportunity;
  amountMinor: number;
  occurredOn: IsoDate;
  budgetCycleId: string;
}): SavingsGoalContribution {
  return savingsGoalContribution({
    goalId,
    amountMinor,
    occurredOn,
    source: "save_difference",
    status: "pending_transfer",
    linkedBudgetCycleId: budgetCycleId,
    note: `Save-the-Difference from ${opportunity.categoryName}.`
  });
}

function roundDivide(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}
