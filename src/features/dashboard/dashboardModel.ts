import { calculateSafeToSpend, type SafeToSpendPeriod, type SafeToSpendResult } from "../../domain/forecasting/safeToSpend";
import {
  calculateCashFlowProjection,
  cloneAllocationsForVirtualCycle,
  createVirtualFutureCycle,
  projectedSalaryMinor,
  type CashFlowProjection
} from "../../domain/forecasting/cashFlowProjection";
import { addDays, compareIsoDate, daysBetweenInclusive, endOfMonth, isWithinInclusive } from "../../domain/dates";
import type { Account, BalanceSnapshot, BluehourSnapshot, BudgetCycle, IsoDate, PlanInstance } from "../../domain/types";
import { isActive } from "../../domain/types";

export interface DashboardPeriodResult {
  label: string;
  available: SafeToSpendResult;
  projected: SafeToSpendResult;
  cashFlow: CashFlowProjection;
}

export interface DashboardModel {
  activeCycle: BudgetCycle;
  periods: Record<SafeToSpendPeriod, DashboardPeriodResult>;
}

export interface DailyTimelinePoint {
  date: IsoDate;
  balanceMinor: number;
  labels: string[];
  isLowest: boolean;
  isBelowBuffer: boolean;
}

export function buildDashboardModel(snapshot: BluehourSnapshot, asOfDate: IsoDate): DashboardModel {
  const activeCycle = snapshot.budgetCycles.find((cycle) => cycle.status === "open");
  if (!activeCycle) {
    throw new Error("No open salary cycle is available");
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
          projected: calculateProjectedSafeToSpend(snapshot, activeCycle, asOfDate, config.horizonEndDate),
          cashFlow: calculateCashFlowProjection({
            snapshot,
            cycle: activeCycle,
            asOfDate,
            horizonEndDate: config.horizonEndDate
          })
        }
      ];
    })
  ) as Record<SafeToSpendPeriod, DashboardPeriodResult>;

  return { activeCycle, periods };
}

export function buildDailyTimeline(projection: CashFlowProjection, maxDays = 30): DailyTimelinePoint[] {
  return projection.days.slice(0, maxDays).map((day) => ({
    date: day.date,
    balanceMinor: day.balanceMinor,
    labels: day.events.map((event) => (event.isAssumption ? `${event.label} (assumed)` : event.label)),
    isLowest: day.isLowest,
    isBelowBuffer: day.isBelowBuffer
  }));
}

function calculateProjectedSafeToSpend(
  snapshot: BluehourSnapshot,
  activeCycle: BudgetCycle,
  asOfDate: IsoDate,
  horizonEndDate: IsoDate
): SafeToSpendResult {
  if (compareIsoDate(horizonEndDate, activeCycle.expectedNextSalaryTo) < 0) {
    return calculateSafeToSpend({
      asOfDate,
      horizonEndDate,
      cycle: activeCycle,
      accounts: snapshot.accounts,
      balanceSnapshots: snapshot.balanceSnapshots,
      transactions: snapshot.transactions,
      transactionLegs: snapshot.transactionLegs,
      transactionSplits: snapshot.transactionSplits,
      categories: snapshot.categories,
      budgetAllocations: snapshot.budgetAllocations,
      budgetTransfers: snapshot.budgetTransfers,
      planInstances: snapshot.planInstances,
      includeFutureIncome: true
    });
  }

  const salaryDate = activeCycle.expectedNextSalaryTo;
  const currentEndDate = addDays(salaryDate, -1);
  const currentSegment = calculateSafeToSpend({
    asOfDate,
    horizonEndDate: currentEndDate,
    cycle: activeCycle,
    accounts: snapshot.accounts,
    balanceSnapshots: snapshot.balanceSnapshots,
    transactions: snapshot.transactions,
    transactionLegs: snapshot.transactionLegs,
    transactionSplits: snapshot.transactionSplits,
    categories: snapshot.categories,
    budgetAllocations: snapshot.budgetAllocations,
    budgetTransfers: snapshot.budgetTransfers,
    planInstances: snapshot.planInstances,
    includeFutureIncome: true
  });

  const futureCycle = createVirtualFutureCycle(activeCycle, salaryDate, projectedSalaryMinor(snapshot.planInstances, activeCycle));
  const futureAccount = createVirtualSpendableAccount(snapshot.accounts);
  const futureStartingBalance =
    (currentSegment.forecast.at(-1)?.balanceMinor ?? currentSegment.netSpendableBalanceMinor + currentSegment.countedFutureIncomeMinor) +
    futureCycle.actualMainSalaryMinor +
    confirmedNonSalaryIncomeOnDate(snapshot.planInstances, activeCycle, salaryDate);
  const futureSnapshot = createVirtualBalanceSnapshot(futureAccount.id, salaryDate, futureStartingBalance);
  const futureAllocations = cloneAllocationsForVirtualCycle(activeCycle.id, futureCycle.id, snapshot.budgetAllocations);
  const futureSegment = calculateSafeToSpend({
    asOfDate: salaryDate,
    horizonEndDate,
    cycle: futureCycle,
    accounts: [futureAccount],
    balanceSnapshots: [futureSnapshot],
    transactions: [],
    transactionLegs: [],
    transactionSplits: [],
    categories: snapshot.categories,
    budgetAllocations: [...snapshot.budgetAllocations, ...futureAllocations],
    budgetTransfers: [],
    planInstances: filterFuturePlans(snapshot.planInstances, activeCycle),
    includeFutureIncome: true
  });

  return combineCrossCycleProjection(currentSegment, futureSegment, asOfDate, horizonEndDate);
}

function createVirtualSpendableAccount(accounts: readonly Account[]): Account {
  const template =
    accounts.find((account) => isActive(account) && account.role === "spendable") ??
    accounts.find((account) => isActive(account) && account.type === "credit_card") ??
    accounts.find(isActive);

  return {
    ...(template ?? {
      createdAt: "virtual",
      updatedAt: "virtual",
      archivedAt: null,
      revision: 1,
      name: "Projected cash",
      type: "bank" as const,
      role: "spendable" as const,
      trackingMode: "manual_snapshot" as const,
      currency: "MYR" as const,
      reconcileWeekly: false,
      sortOrder: 0
    }),
    id: "virtual-projected-cash",
    name: "Projected cash",
    role: "spendable",
    type: "bank",
    trackingMode: "manual_snapshot"
  };
}

function createVirtualBalanceSnapshot(accountId: string, asOfDate: IsoDate, amountMinor: number): BalanceSnapshot {
  return {
    id: "virtual-projected-cash-balance",
    accountId,
    asOfDate,
    amountMinor,
    source: "manual_valuation",
    note: "Projected from the current cycle through conservative salary date.",
    createdAt: "virtual",
    updatedAt: "virtual",
    archivedAt: null,
    revision: 1
  };
}

function confirmedNonSalaryIncomeOnDate(planInstances: readonly PlanInstance[], activeCycle: BudgetCycle, date: IsoDate): number {
  return planInstances
    .filter(
      (plan) =>
        isActive(plan) &&
        plan.kind === "income" &&
        plan.status === "scheduled" &&
        plan.confidence === "confirmed" &&
        plan.expectedDate === date &&
        !(
          plan.isMainSalaryEstimate &&
          isWithinInclusive(plan.expectedDate, activeCycle.expectedNextSalaryFrom, activeCycle.expectedNextSalaryTo)
        )
    )
    .reduce((total, plan) => total + plan.expectedAmountMinor, 0);
}

function filterFuturePlans(planInstances: readonly PlanInstance[], activeCycle: BudgetCycle): PlanInstance[] {
  return planInstances.filter(
    (plan) =>
      !(
        plan.isMainSalaryEstimate &&
        isWithinInclusive(plan.expectedDate, activeCycle.expectedNextSalaryFrom, activeCycle.expectedNextSalaryTo)
      )
  );
}

function combineCrossCycleProjection(
  currentSegment: SafeToSpendResult,
  futureSegment: SafeToSpendResult,
  asOfDate: IsoDate,
  horizonEndDate: IsoDate
): SafeToSpendResult {
  const forecast = [
    ...currentSegment.forecast,
    ...futureSegment.forecast.filter((point, index) => index > 0 || point.date !== currentSegment.forecast.at(-1)?.date)
  ];
  const lowest = forecast.reduce((lowestPoint, point) => (point.balanceMinor < lowestPoint.balanceMinor ? point : lowestPoint), forecast[0]);
  const safeToSpendMinor = Math.max(0, Math.min(currentSegment.safeToSpendMinor, futureSegment.safeToSpendMinor));
  const remainingDays = daysBetweenInclusive(asOfDate, horizonEndDate);
  const limitingSegment = currentSegment.safeToSpendMinor <= futureSegment.safeToSpendMinor ? currentSegment : futureSegment;

  return {
    ...currentSegment,
    horizonEndDate,
    remainingDays,
    countedFutureIncomeMinor: currentSegment.countedFutureIncomeMinor + futureSegment.countedFutureIncomeMinor,
    committedReserveMinor: currentSegment.committedReserveMinor + futureSegment.committedReserveMinor,
    essentialEnvelopeReserveMinor: currentSegment.essentialEnvelopeReserveMinor + futureSegment.essentialEnvelopeReserveMinor,
    protectedReserveMinor: currentSegment.protectedReserveMinor + futureSegment.protectedReserveMinor,
    bufferReserveMinor: limitingSegment.bufferReserveMinor,
    cashCapacityMinor: Math.min(currentSegment.cashCapacityMinor, futureSegment.cashCapacityMinor),
    discretionaryRemainderMinor: Math.min(currentSegment.discretionaryRemainderMinor, futureSegment.discretionaryRemainderMinor),
    safeToSpendMinor,
    dailyAmountMinor: Math.floor(safeToSpendMinor / remainingDays),
    shortfallMinor: Math.max(currentSegment.shortfallMinor, futureSegment.shortfallMinor),
    lowestProjectedBalanceMinor: lowest?.balanceMinor ?? currentSegment.lowestProjectedBalanceMinor,
    lowestProjectedBalanceDate: lowest?.date ?? currentSegment.lowestProjectedBalanceDate,
    forecast,
    breakdown: {
      ...currentSegment.breakdown,
      includedIncome: [...currentSegment.breakdown.includedIncome, ...futureSegment.breakdown.includedIncome],
      excludedIncome: [...currentSegment.breakdown.excludedIncome, ...futureSegment.breakdown.excludedIncome],
      committedPlans: [...currentSegment.breakdown.committedPlans, ...futureSegment.breakdown.committedPlans],
      essentialEnvelopeReserves: [
        ...currentSegment.breakdown.essentialEnvelopeReserves,
        ...futureSegment.breakdown.essentialEnvelopeReserves.map((reserve) => ({
          ...reserve,
          id: `virtual-${reserve.id}`,
          label: `${reserve.label} (estimated next cycle)`
        }))
      ],
      protectedTargetMinor: currentSegment.breakdown.protectedTargetMinor + futureSegment.breakdown.protectedTargetMinor,
      completedProtectedMinor: currentSegment.breakdown.completedProtectedMinor + futureSegment.breakdown.completedProtectedMinor,
      protectedReserveMinor: currentSegment.protectedReserveMinor + futureSegment.protectedReserveMinor,
      bufferBaseMinor: limitingSegment.breakdown.bufferBaseMinor,
      bufferReserveMinor: limitingSegment.bufferReserveMinor,
      discretionaryAllocationMinor:
        currentSegment.breakdown.discretionaryAllocationMinor + futureSegment.breakdown.discretionaryAllocationMinor,
      discretionarySpentMinor: currentSegment.breakdown.discretionarySpentMinor + futureSegment.breakdown.discretionarySpentMinor,
      discretionaryReservedPlansMinor:
        currentSegment.breakdown.discretionaryReservedPlansMinor + futureSegment.breakdown.discretionaryReservedPlansMinor,
      discretionaryRemainderMinor: Math.min(
        currentSegment.breakdown.discretionaryRemainderMinor,
        futureSegment.breakdown.discretionaryRemainderMinor
      ),
      exclusions: [...currentSegment.breakdown.exclusions, ...futureSegment.breakdown.exclusions],
      warnings: [
        ...currentSegment.breakdown.warnings,
        ...futureSegment.breakdown.warnings,
        "Projected salary starts an estimated next salary cycle using the current approved budget template.",
        "Cross-cycle safety buffers are evaluated per salary segment; the limiting segment controls the projected safe-to-spend figure."
      ]
    }
  };
}
