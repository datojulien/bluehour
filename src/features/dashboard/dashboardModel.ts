import { calculateSafeToSpend, type SafeToSpendPeriod, type SafeToSpendResult } from "../../domain/forecasting/safeToSpend";
import { addDays, compareIsoDate, daysBetweenInclusive, endOfMonth, isWithinInclusive } from "../../domain/dates";
import { nextSalaryWindowFromStart } from "../../domain/forecasting/salaryCycle";
import type { Account, BalanceSnapshot, BluehourSnapshot, BudgetAllocation, BudgetCycle, IsoDate, PlanInstance } from "../../domain/types";
import { isActive } from "../../domain/types";

export interface DashboardPeriodResult {
  label: string;
  available: SafeToSpendResult;
  projected: SafeToSpendResult;
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
          projected: calculateProjectedSafeToSpend(snapshot, activeCycle, asOfDate, config.horizonEndDate)
        }
      ];
    })
  ) as Record<SafeToSpendPeriod, DashboardPeriodResult>;

  return { activeCycle, periods };
}

export function buildDailyTimeline(result: SafeToSpendResult, maxDays = 30): DailyTimelinePoint[] {
  const daysToShow = Math.min(result.remainingDays, maxDays);
  const eventLabelsByDate = new Map<IsoDate, string[]>();
  result.forecast.forEach((point) => {
    if (!point.label || point.label === "Today" || point.label === "Horizon") {
      return;
    }

    const labels = eventLabelsByDate.get(point.date) ?? [];
    labels.push(point.label);
    eventLabelsByDate.set(point.date, labels);
  });

  let cursorBalance = result.netSpendableBalanceMinor;
  let forecastIndex = 0;

  return Array.from({ length: daysToShow }, (_, offset) => {
    const date = addDays(result.asOfDate, offset);
    while (forecastIndex < result.forecast.length && compareIsoDate(result.forecast[forecastIndex].date, date) <= 0) {
      cursorBalance = result.forecast[forecastIndex].balanceMinor;
      forecastIndex += 1;
    }

    return {
      date,
      balanceMinor: cursorBalance,
      labels: eventLabelsByDate.get(date) ?? [],
      isLowest: date === result.lowestProjectedBalanceDate
    };
  });
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
  const currentSegment = calculateSafeToSpend({
    asOfDate,
    horizonEndDate: salaryDate,
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
  const futureStartingBalance = currentSegment.forecast.at(-1)?.balanceMinor ?? currentSegment.netSpendableBalanceMinor + currentSegment.countedFutureIncomeMinor;
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
    planInstances: snapshot.planInstances,
    includeFutureIncome: false
  });

  return combineCrossCycleProjection(currentSegment, futureSegment, asOfDate, horizonEndDate);
}

function createVirtualFutureCycle(currentCycle: BudgetCycle, salaryDate: IsoDate, salaryMinor: number): BudgetCycle {
  const window = nextSalaryWindowFromStart(salaryDate, 24, 26);
  return {
    ...currentCycle,
    id: `${currentCycle.id}-virtual-next`,
    startedOn: salaryDate,
    endedOn: undefined,
    status: "open",
    salaryTransactionId: "virtual-main-salary",
    expectedNextSalaryFrom: window.expectedNextSalaryFrom,
    expectedNextSalaryTo: window.expectedNextSalaryTo,
    actualMainSalaryMinor: salaryMinor,
    closedAt: undefined
  };
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

function cloneAllocationsForVirtualCycle(
  currentCycleId: string,
  virtualCycleId: string,
  allocations: readonly BudgetAllocation[]
): BudgetAllocation[] {
  return allocations
    .filter((allocation) => isActive(allocation) && allocation.budgetCycleId === currentCycleId)
    .map((allocation) => ({
      ...allocation,
      id: `virtual-${allocation.id}`,
      budgetCycleId: virtualCycleId,
      note: "Estimated from the current approved budget template."
    }));
}

function projectedSalaryMinor(planInstances: readonly PlanInstance[], activeCycle: BudgetCycle): number {
  const estimate = planInstances.find(
    (plan) =>
      isActive(plan) &&
      plan.kind === "income" &&
      plan.status === "scheduled" &&
      plan.isMainSalaryEstimate &&
      isWithinInclusive(plan.expectedDate, activeCycle.expectedNextSalaryFrom, activeCycle.expectedNextSalaryTo)
  );
  return estimate?.expectedAmountMinor ?? activeCycle.actualMainSalaryMinor;
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

  return {
    ...currentSegment,
    horizonEndDate,
    remainingDays,
    countedFutureIncomeMinor: currentSegment.countedFutureIncomeMinor + futureSegment.countedFutureIncomeMinor,
    committedReserveMinor: currentSegment.committedReserveMinor + futureSegment.committedReserveMinor,
    essentialEnvelopeReserveMinor: currentSegment.essentialEnvelopeReserveMinor + futureSegment.essentialEnvelopeReserveMinor,
    protectedReserveMinor: currentSegment.protectedReserveMinor + futureSegment.protectedReserveMinor,
    bufferReserveMinor: currentSegment.bufferReserveMinor + futureSegment.bufferReserveMinor,
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
      bufferBaseMinor: currentSegment.breakdown.bufferBaseMinor + futureSegment.breakdown.bufferBaseMinor,
      bufferReserveMinor: currentSegment.bufferReserveMinor + futureSegment.bufferReserveMinor,
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
        "Projected salary starts an estimated next salary cycle using the current approved budget template."
      ]
    }
  };
}
