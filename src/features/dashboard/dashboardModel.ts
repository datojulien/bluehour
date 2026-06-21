import { calculateSafeToSpend, type SafeToSpendPeriod, type SafeToSpendResult } from "../../domain/forecasting/safeToSpend";
import { addDays, endOfMonth } from "../../domain/dates";
import type { BluehourSnapshot, BudgetCycle, IsoDate } from "../../domain/types";

export interface DashboardPeriodResult {
  label: string;
  available: SafeToSpendResult;
  projected: SafeToSpendResult;
}

export interface DashboardModel {
  activeCycle: BudgetCycle;
  periods: Record<SafeToSpendPeriod, DashboardPeriodResult>;
}

export function buildDashboardModel(snapshot: BluehourSnapshot, asOfDate: IsoDate): DashboardModel {
  const activeCycle = snapshot.budgetCycles.find((cycle) => cycle.status === "open");
  if (!activeCycle) {
    throw new Error("Demo data does not include an open salary cycle");
  }

  const horizons: Record<SafeToSpendPeriod, { label: string; horizonEndDate: IsoDate }> = {
    untilSalary: {
      label: "Until salary",
      horizonEndDate: addDays(activeCycle.expectedNextSalaryTo, -1)
    },
    thisMonth: {
      label: "This month",
      horizonEndDate: endOfMonth(asOfDate)
    },
    next30Days: {
      label: "Next 30 days",
      horizonEndDate: addDays(asOfDate, 29)
    }
  };

  const periods = Object.fromEntries(
    Object.entries(horizons).map(([period, config]) => {
      const baseInput = {
        asOfDate,
        horizonEndDate: config.horizonEndDate,
        cycle: activeCycle,
        accounts: snapshot.accounts,
        balanceSnapshots: snapshot.balanceSnapshots,
        transactions: snapshot.transactions,
        transactionLegs: snapshot.transactionLegs,
        transactionSplits: snapshot.transactionSplits,
        categories: snapshot.categories,
        budgetAllocations: snapshot.budgetAllocations,
        budgetTransfers: snapshot.budgetTransfers,
        planInstances: snapshot.planInstances
      };

      return [
        period,
        {
          label: config.label,
          available: calculateSafeToSpend({ ...baseInput, includeFutureIncome: false }),
          projected: calculateSafeToSpend({ ...baseInput, includeFutureIncome: true })
        }
      ];
    })
  ) as Record<SafeToSpendPeriod, DashboardPeriodResult>;

  return { activeCycle, periods };
}
