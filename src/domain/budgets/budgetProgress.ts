import { addDays, isOnOrAfter, isWithinInclusive } from "../dates";
import { calculateCategoryActuals } from "../transactions/calculations";
import type { BluehourSnapshot, BudgetCycle, Category, IsoDate } from "../types";
import { isActive } from "../types";
import { calculateCategoryAllocation } from "./calculations";

export type BudgetProgressState = "on_track" | "near_limit" | "overspent" | "no_allocation" | "fully_reserved";

export interface BudgetProgressRow {
  categoryId: string;
  categoryName: string;
  category: Category;
  allocationMinor: number;
  spentMinor: number;
  reservedFuturePlansMinor: number;
  remainingBeforeFuturePlansMinor: number;
  remainingAfterFuturePlansMinor: number;
  percentageUsedOrReserved: number;
  state: BudgetProgressState;
}

export interface BudgetProgressInput {
  snapshot: BluehourSnapshot;
  cycle: BudgetCycle;
  asOfDate: IsoDate;
  horizonEndDate?: IsoDate;
  categoryFilter?: (category: Category) => boolean;
}

export function buildBudgetProgressRows({
  snapshot,
  cycle,
  asOfDate,
  horizonEndDate = addDays(cycle.expectedNextSalaryTo, -1),
  categoryFilter = defaultBudgetCategoryFilter
}: BudgetProgressInput): BudgetProgressRow[] {
  const categories = snapshot.categories
    .filter((category) => isActive(category) && category.active && categoryFilter(category))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));

  return categories.map((category) => {
    const allocationMinor = calculateCategoryAllocation(category.id, cycle, snapshot.budgetAllocations, snapshot.budgetTransfers);
    const spentMinor = calculateCategoryActuals(category.id, snapshot.transactions, snapshot.transactionSplits, cycle.startedOn, asOfDate);
    const reservedFuturePlansMinor = calculateReservedFuturePlans(category.id, snapshot, asOfDate, horizonEndDate);
    const remainingBeforeFuturePlansMinor = allocationMinor - spentMinor;
    const remainingAfterFuturePlansMinor = allocationMinor - spentMinor - reservedFuturePlansMinor;
    const percentageUsedOrReserved = allocationMinor > 0 ? percentageRounded(spentMinor + reservedFuturePlansMinor, allocationMinor) : 0;

    return {
      categoryId: category.id,
      categoryName: category.name,
      category,
      allocationMinor,
      spentMinor,
      reservedFuturePlansMinor,
      remainingBeforeFuturePlansMinor,
      remainingAfterFuturePlansMinor,
      percentageUsedOrReserved,
      state: budgetProgressState(allocationMinor, spentMinor, reservedFuturePlansMinor, remainingAfterFuturePlansMinor, percentageUsedOrReserved)
    };
  });
}

export function defaultBudgetCategoryFilter(category: Category): boolean {
  return category.reservationMode !== "none" && category.nature !== "administrative" && category.nature !== "protected";
}

function calculateReservedFuturePlans(
  categoryId: string,
  snapshot: BluehourSnapshot,
  asOfDate: IsoDate,
  horizonEndDate: IsoDate
): number {
  return snapshot.planInstances
    .filter(
      (plan) =>
        isActive(plan) &&
        plan.kind !== "income" &&
        plan.reservation === "reserved" &&
        plan.status === "scheduled" &&
        plan.categoryId === categoryId &&
        isOnOrAfter(plan.expectedDate, asOfDate) &&
        isWithinInclusive(plan.expectedDate, asOfDate, horizonEndDate)
    )
    .reduce((total, plan) => total + plan.expectedAmountMinor, 0);
}

function budgetProgressState(
  allocationMinor: number,
  spentMinor: number,
  reservedFuturePlansMinor: number,
  remainingAfterFuturePlansMinor: number,
  percentageUsedOrReserved: number
): BudgetProgressState {
  if (allocationMinor <= 0) {
    return "no_allocation";
  }

  if (remainingAfterFuturePlansMinor < 0 || spentMinor > allocationMinor) {
    return "overspent";
  }

  if (spentMinor + reservedFuturePlansMinor >= allocationMinor) {
    return "fully_reserved";
  }

  if (percentageUsedOrReserved >= 80) {
    return "near_limit";
  }

  return "on_track";
}

function percentageRounded(numeratorMinor: number, denominatorMinor: number): number {
  if (denominatorMinor <= 0) {
    return 0;
  }

  return Math.max(0, Math.floor((numeratorMinor * 100 + Math.floor(denominatorMinor / 2)) / denominatorMinor));
}
