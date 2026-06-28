import { addDays } from "../../domain/dates";
import { buildBudgetProgressRows, type BudgetProgressRow } from "../../domain/budgets/budgetProgress";
import type { BluehourSnapshot, BudgetCycle, IsoDate } from "../../domain/types";

export type DashboardBudgetRow = BudgetProgressRow;

export function buildBudgetRows(snapshot: BluehourSnapshot, cycle: BudgetCycle, asOfDate: IsoDate): DashboardBudgetRow[] {
  return buildBudgetProgressRows({
    snapshot,
    cycle,
    asOfDate,
    horizonEndDate: addDays(cycle.expectedNextSalaryTo, -1),
    categoryFilter: (category) => category.nature === "discretionary" || category.nature === "essential"
  });
}
