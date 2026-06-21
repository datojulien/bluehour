import { calculateAccountBalances, calculateNetSpendableBalance, type AccountBalance } from "../accounts/calculations";
import { calculateCategoryAllocation, calculateRemainingAllocation } from "../budgets/calculations";
import { addDays, compareIsoDate, daysBetweenInclusive, isOnOrAfter, isOnOrBefore, isWithinInclusive } from "../dates";
import { clampNonNegative, percentageOfMinor } from "../money";
import { calculateCategoryActuals } from "../transactions/calculations";
import type {
  Account,
  BalanceSnapshot,
  BudgetAllocation,
  BudgetCycle,
  BudgetTransfer,
  Category,
  IsoDate,
  PlanInstance,
  Transaction,
  TransactionLeg,
  TransactionSplit
} from "../types";
import { isActive } from "../types";

export type SafeToSpendPeriod = "untilSalary" | "thisMonth" | "next30Days";

export interface SafeToSpendInput {
  asOfDate: IsoDate;
  horizonEndDate: IsoDate;
  cycle: BudgetCycle;
  accounts: readonly Account[];
  balanceSnapshots: readonly BalanceSnapshot[];
  transactions: readonly Transaction[];
  transactionLegs: readonly TransactionLeg[];
  transactionSplits: readonly TransactionSplit[];
  categories: readonly Category[];
  budgetAllocations: readonly BudgetAllocation[];
  budgetTransfers: readonly BudgetTransfer[];
  planInstances: readonly PlanInstance[];
  includeFutureIncome: boolean;
}

export interface ReserveLine {
  id: string;
  label: string;
  amountMinor: number;
  date?: IsoDate;
}

export interface ForecastPoint {
  date: IsoDate;
  balanceMinor: number;
  label?: string;
}

export interface SafeToSpendBreakdown {
  accountBalances: AccountBalance[];
  includedIncome: ReserveLine[];
  excludedIncome: ReserveLine[];
  committedPlans: ReserveLine[];
  essentialEnvelopeReserves: ReserveLine[];
  protectedTargetMinor: number;
  completedProtectedMinor: number;
  protectedReserveMinor: number;
  bufferBaseMinor: number;
  bufferReserveMinor: number;
  discretionaryAllocationMinor: number;
  discretionarySpentMinor: number;
  discretionaryReservedPlansMinor: number;
  discretionaryRemainderMinor: number;
  exclusions: string[];
  warnings: string[];
}

export interface SafeToSpendResult {
  asOfDate: IsoDate;
  horizonEndDate: IsoDate;
  remainingDays: number;
  netSpendableBalanceMinor: number;
  countedFutureIncomeMinor: number;
  committedReserveMinor: number;
  essentialEnvelopeReserveMinor: number;
  protectedReserveMinor: number;
  bufferReserveMinor: number;
  cashCapacityMinor: number;
  discretionaryRemainderMinor: number;
  safeToSpendMinor: number;
  dailyAmountMinor: number;
  shortfallMinor: number;
  lowestProjectedBalanceMinor: number;
  lowestProjectedBalanceDate: IsoDate;
  forecast: ForecastPoint[];
  breakdown: SafeToSpendBreakdown;
}

export function calculateSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const activeCategories = input.categories.filter((category) => isActive(category) && category.active);
  const categoryById = new Map(activeCategories.map((category) => [category.id, category]));
  const accountBalances = calculateAccountBalances(
    input.accounts,
    input.balanceSnapshots,
    input.transactions,
    input.transactionLegs,
    input.asOfDate
  );
  const netSpendableBalanceMinor = calculateNetSpendableBalance(accountBalances);

  const { includedIncome, excludedIncome } = calculateFutureIncome(input);
  const countedFutureIncomeMinor = includedIncome.reduce((total, income) => total + income.amountMinor, 0);
  const committedPlans = calculateCommittedPlans(input, categoryById);
  const committedReserveMinor = committedPlans.reduce((total, plan) => total + plan.amountMinor, 0);
  const essentialEnvelopeReserves = calculateEssentialEnvelopeReserves(input, activeCategories, categoryById);
  const essentialEnvelopeReserveMinor = essentialEnvelopeReserves.reduce((total, reserve) => total + reserve.amountMinor, 0);
  const completedProtectedMinor = calculateCompletedProtectedTransfers(input);
  const protectedTargetMinor =
    percentageOfMinor(input.cycle.actualMainSalaryMinor, input.cycle.protectedRateBasisPoints) +
    (input.cycle.additionalProtectedCommitmentMinor ?? 0);
  const protectedReserveMinor = clampNonNegative(protectedTargetMinor - completedProtectedMinor);
  const bufferBaseMinor = committedReserveMinor + essentialEnvelopeReserveMinor;
  const bufferReserveMinor = Math.max(input.cycle.bufferMinimumMinor, percentageOfMinor(bufferBaseMinor, input.cycle.bufferEssentialRateBasisPoints));
  const discretionary = calculateDiscretionaryRemainder(input, activeCategories, categoryById);
  const cashCapacityMinor =
    netSpendableBalanceMinor +
    countedFutureIncomeMinor -
    committedReserveMinor -
    essentialEnvelopeReserveMinor -
    protectedReserveMinor -
    bufferReserveMinor;
  const safeToSpendMinor = Math.max(0, Math.min(cashCapacityMinor, discretionary.discretionaryRemainderMinor));
  const remainingDays = daysBetweenInclusive(input.asOfDate, input.horizonEndDate);
  const dailyAmountMinor = Math.floor(safeToSpendMinor / remainingDays);
  const forecast = calculateForecast(input, netSpendableBalanceMinor, includedIncome, committedPlans);
  const lowest = forecast.reduce((lowestPoint, point) => (point.balanceMinor < lowestPoint.balanceMinor ? point : lowestPoint), forecast[0]);
  const warnings: string[] = [];

  if (cashCapacityMinor < 0) {
    warnings.push("Projected cash capacity is below zero before discretionary spending.");
  }

  if (safeToSpendMinor === 0) {
    warnings.push("Safe to spend is RM0.00 for this horizon.");
  }

  if (discretionary.discretionaryRemainderMinor < cashCapacityMinor) {
    warnings.push("Discretionary budget is the limiting factor.");
  }

  return {
    asOfDate: input.asOfDate,
    horizonEndDate: input.horizonEndDate,
    remainingDays,
    netSpendableBalanceMinor,
    countedFutureIncomeMinor,
    committedReserveMinor,
    essentialEnvelopeReserveMinor,
    protectedReserveMinor,
    bufferReserveMinor,
    cashCapacityMinor,
    discretionaryRemainderMinor: discretionary.discretionaryRemainderMinor,
    safeToSpendMinor,
    dailyAmountMinor,
    shortfallMinor: cashCapacityMinor < 0 ? Math.abs(cashCapacityMinor) : 0,
    lowestProjectedBalanceMinor: lowest?.balanceMinor ?? netSpendableBalanceMinor,
    lowestProjectedBalanceDate: lowest?.date ?? input.asOfDate,
    forecast,
    breakdown: {
      accountBalances,
      includedIncome,
      excludedIncome,
      committedPlans,
      essentialEnvelopeReserves,
      protectedTargetMinor,
      completedProtectedMinor,
      protectedReserveMinor,
      bufferBaseMinor,
      bufferReserveMinor,
      discretionaryAllocationMinor: discretionary.discretionaryAllocationMinor,
      discretionarySpentMinor: discretionary.discretionarySpentMinor,
      discretionaryReservedPlansMinor: discretionary.discretionaryReservedPlansMinor,
      discretionaryRemainderMinor: discretionary.discretionaryRemainderMinor,
      exclusions: excludedIncome.map((income) => `${income.label} is ${income.amountMinor > 0 ? "excluded from" : "not counted in"} safe-to-spend.`),
      warnings
    }
  };
}

function calculateFutureIncome(input: SafeToSpendInput): { includedIncome: ReserveLine[]; excludedIncome: ReserveLine[] } {
  const includedIncome: ReserveLine[] = [];
  const excludedIncome: ReserveLine[] = [];

  input.planInstances
    .filter((plan) => {
      return (
        isActive(plan) &&
        plan.kind === "income" &&
        plan.status === "scheduled" &&
        isOnOrAfter(plan.expectedDate, addDays(input.asOfDate, 1)) &&
        isOnOrBefore(plan.expectedDate, input.horizonEndDate)
      );
    })
    .forEach((plan) => {
      const line = {
        id: plan.id,
        label: plan.name,
        amountMinor: plan.expectedAmountMinor,
        date: plan.expectedDate
      };

      if (input.includeFutureIncome && (plan.confidence === "confirmed" || plan.isMainSalaryEstimate)) {
        includedIncome.push(line);
      } else {
        excludedIncome.push(line);
      }
    });

  return { includedIncome, excludedIncome };
}

function calculateCommittedPlans(input: SafeToSpendInput, categoryById: Map<string, Category>): ReserveLine[] {
  return input.planInstances
    .filter((plan) => {
      const category = plan.categoryId ? categoryById.get(plan.categoryId) : undefined;
      return (
        isActive(plan) &&
        plan.kind !== "income" &&
        plan.reservation === "reserved" &&
        plan.status === "scheduled" &&
        isWithinInclusive(plan.expectedDate, input.asOfDate, input.horizonEndDate) &&
        category?.reservationMode === "plan"
      );
    })
    .map((plan) => ({
      id: plan.id,
      label: plan.name,
      amountMinor: plan.expectedAmountMinor,
      date: plan.expectedDate
    }));
}

function calculateEssentialEnvelopeReserves(
  input: SafeToSpendInput,
  activeCategories: readonly Category[],
  categoryById: Map<string, Category>
): ReserveLine[] {
  return activeCategories
    .filter((category) => category.nature === "essential" && category.reservationMode === "envelope")
    .map((category) => {
      const allocation = calculateCategoryAllocation(category.id, input.cycle, input.budgetAllocations, input.budgetTransfers);
      const spent = calculateCategoryActuals(category.id, input.transactions, input.transactionSplits, input.cycle.startedOn, input.asOfDate);
      const remainingAllocation = calculateRemainingAllocation(allocation, spent);
      const plannedEssential = input.planInstances
        .filter((plan) => {
          return (
            isActive(plan) &&
            plan.kind !== "income" &&
            plan.reservation === "reserved" &&
            plan.status === "scheduled" &&
            plan.categoryId === category.id &&
            isWithinInclusive(plan.expectedDate, input.asOfDate, input.horizonEndDate)
          );
        })
        .reduce((total, plan) => total + plan.expectedAmountMinor, 0);

      return {
        id: category.id,
        label: category.name,
        amountMinor: Math.max(remainingAllocation, plannedEssential)
      };
    })
    .filter((reserve) => reserve.amountMinor > 0);
}

function calculateCompletedProtectedTransfers(input: SafeToSpendInput): number {
  const protectedAccountIds = new Set(
    input.accounts.filter((account) => isActive(account) && account.role === "protected").map((account) => account.id)
  );
  const transactionById = new Map(input.transactions.filter(isActive).map((transaction) => [transaction.id, transaction]));

  return input.transactionLegs
    .filter((leg) => {
      const transaction = transactionById.get(leg.transactionId);
      return (
        isActive(leg) &&
        protectedAccountIds.has(leg.accountId) &&
        leg.deltaMinor > 0 &&
        transaction?.type === "transfer" &&
        isWithinInclusive(transaction.occurredOn, input.cycle.startedOn, input.asOfDate)
      );
    })
    .reduce((total, leg) => total + leg.deltaMinor, 0);
}

function calculateDiscretionaryRemainder(
  input: SafeToSpendInput,
  activeCategories: readonly Category[],
  categoryById: Map<string, Category>
): {
  discretionaryAllocationMinor: number;
  discretionarySpentMinor: number;
  discretionaryReservedPlansMinor: number;
  discretionaryRemainderMinor: number;
} {
  const discretionaryCategories = activeCategories.filter((category) => category.nature === "discretionary");
  const discretionaryAllocationMinor = discretionaryCategories.reduce(
    (total, category) => total + calculateCategoryAllocation(category.id, input.cycle, input.budgetAllocations, input.budgetTransfers),
    0
  );
  const discretionarySpentMinor = discretionaryCategories.reduce(
    (total, category) => total + calculateCategoryActuals(category.id, input.transactions, input.transactionSplits, input.cycle.startedOn, input.asOfDate),
    0
  );
  const discretionaryReservedPlansMinor = input.planInstances
    .filter((plan) => {
      const category = plan.categoryId ? categoryById.get(plan.categoryId) : undefined;
      return (
        isActive(plan) &&
        plan.kind !== "income" &&
        plan.reservation === "reserved" &&
        plan.status === "scheduled" &&
        category?.nature === "discretionary" &&
        isWithinInclusive(plan.expectedDate, input.asOfDate, input.horizonEndDate)
      );
    })
    .reduce((total, plan) => total + plan.expectedAmountMinor, 0);

  return {
    discretionaryAllocationMinor,
    discretionarySpentMinor,
    discretionaryReservedPlansMinor,
    discretionaryRemainderMinor: Math.max(0, discretionaryAllocationMinor - discretionarySpentMinor - discretionaryReservedPlansMinor)
  };
}

function calculateForecast(
  input: SafeToSpendInput,
  startingBalanceMinor: number,
  includedIncome: ReserveLine[],
  committedPlans: ReserveLine[]
): ForecastPoint[] {
  const events = [
    ...includedIncome.map((income) => ({ date: income.date ?? input.asOfDate, deltaMinor: income.amountMinor, label: income.label })),
    ...committedPlans.map((plan) => ({ date: plan.date ?? input.asOfDate, deltaMinor: -plan.amountMinor, label: plan.label }))
  ].sort((left, right) => compareIsoDate(left.date, right.date));

  const points: ForecastPoint[] = [{ date: input.asOfDate, balanceMinor: startingBalanceMinor, label: "Today" }];
  let cursorBalance = startingBalanceMinor;

  for (const event of events) {
    cursorBalance += event.deltaMinor;
    points.push({
      date: event.date,
      balanceMinor: cursorBalance,
      label: event.label
    });
  }

  if (points[points.length - 1]?.date !== input.horizonEndDate) {
    points.push({ date: input.horizonEndDate, balanceMinor: cursorBalance, label: "Horizon" });
  }

  return points;
}
