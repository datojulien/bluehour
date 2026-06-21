import type { BudgetAllocation, BudgetCycle, BudgetTransfer } from "../types";
import { isActive } from "../types";

export function calculateBudgetTransferDelta(
  categoryId: string,
  cycleId: string,
  transfers: readonly BudgetTransfer[]
): number {
  return transfers.filter((transfer) => isActive(transfer) && transfer.budgetCycleId === cycleId).reduce((total, transfer) => {
    if (transfer.toCategoryId === categoryId) {
      return total + transfer.amountMinor;
    }

    if (transfer.fromCategoryId === categoryId) {
      return total - transfer.amountMinor;
    }

    return total;
  }, 0);
}

export function calculateCategoryAllocation(
  categoryId: string,
  cycle: BudgetCycle,
  allocations: readonly BudgetAllocation[],
  transfers: readonly BudgetTransfer[]
): number {
  const base = allocations
    .filter((allocation) => isActive(allocation) && allocation.budgetCycleId === cycle.id && allocation.categoryId === categoryId)
    .reduce((total, allocation) => total + allocation.baseAmountMinor, 0);

  return base + calculateBudgetTransferDelta(categoryId, cycle.id, transfers);
}

export function calculateRemainingAllocation(allocationMinor: number, spentMinor: number): number {
  return Math.max(0, allocationMinor - spentMinor);
}

export function assertBudgetTransferSourceAvailable(sourceRemainingMinor: number, transferAmountMinor: number): void {
  if (transferAmountMinor <= 0) {
    throw new Error("Budget transfer amount must be greater than RM0.00");
  }

  if (transferAmountMinor > sourceRemainingMinor) {
    throw new Error("Budget transfer source does not have enough available allocation");
  }
}
