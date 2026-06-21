import { percentageOfMinor } from "../../domain/money";
import type { SafeToSpendResult } from "../../domain/forecasting/safeToSpend";
import type { BluehourSnapshot } from "../../domain/types";

export interface BudgetProgressRow {
  id: string;
  name: string;
  remaining: number;
  percentage: number;
}

export function buildBudgetRows(snapshot: BluehourSnapshot, result: SafeToSpendResult): BudgetProgressRow[] {
  const categoriesById = new Map(snapshot.categories.map((category) => [category.id, category]));

  return snapshot.budgetAllocations
    .filter((allocation) => {
      const category = categoriesById.get(allocation.categoryId);
      return category?.nature === "discretionary" || category?.nature === "essential";
    })
    .slice(0, 6)
    .map((allocation) => {
      const category = categoriesById.get(allocation.categoryId);
      const reserve = result.breakdown.essentialEnvelopeReserves.find((item) => item.id === allocation.categoryId);
      const remaining = reserve?.amountMinor ?? percentageOfMinor(allocation.baseAmountMinor, 5_500);
      const used = Math.max(0, allocation.baseAmountMinor - remaining);
      const percentage = allocation.baseAmountMinor > 0 ? Math.min(100, Math.round((used * 100) / allocation.baseAmountMinor)) : 0;

      return {
        id: allocation.id,
        name: category?.name ?? allocation.categoryId,
        remaining,
        percentage
      };
    });
}
