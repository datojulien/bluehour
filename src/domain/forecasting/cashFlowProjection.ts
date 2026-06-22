import { calculateAccountBalances, calculateNetSpendableBalance } from "../accounts/calculations";
import { calculateCategoryAllocation, calculateRemainingAllocation } from "../budgets/calculations";
import { addDays, compareIsoDate, daysBetweenInclusive, isWithinInclusive } from "../dates";
import { clampNonNegative, percentageOfMinor } from "../money";
import { calculateCategoryActuals } from "../transactions/calculations";
import type {
  Account,
  BluehourSnapshot,
  BudgetAllocation,
  BudgetCycle,
  Category,
  IsoDate,
  PlanInstance,
  RecurringRule,
  Subscription,
} from "../types";
import { isActive } from "../types";
import { nextSalaryWindowFromStart } from "./salaryCycle";

export type ProjectedCashEventKind =
  | "income"
  | "committed_expense"
  | "essential_plan"
  | "essential_distribution"
  | "discretionary_plan"
  | "protected_transfer"
  | "internal_transfer";

export interface ProjectedCashEvent {
  id: string;
  date: IsoDate;
  deltaMinor: number;
  label: string;
  kind: ProjectedCashEventKind;
  sourceId?: string;
  categoryId?: string;
  accountId?: string;
  isAssumption: boolean;
}

export interface ExcludedProjectedIncome {
  id: string;
  date: IsoDate;
  amountMinor: number;
  label: string;
  confidence: PlanInstance["confidence"];
  sourceId: string;
}

export interface ProjectionSegment {
  id: string;
  cycle: BudgetCycle;
  startDate: IsoDate;
  endDate: IsoDate;
  openingBalanceMinor: number;
  bufferThresholdMinor: number;
  protectedTargetMinor: number;
  protectedReserveMinor: number;
  essentialReserveMinor: number;
  committedReserveMinor: number;
  isVirtual: boolean;
}

export interface ProjectedCashFlowDay {
  date: IsoDate;
  balanceMinor: number;
  events: ProjectedCashEvent[];
  segmentId: string;
  bufferThresholdMinor: number;
  isLowest: boolean;
  isBelowBuffer: boolean;
}

export interface CashFlowBufferAssessment {
  segmentId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  bufferThresholdMinor: number;
  lowestBalanceMinor: number;
  lowestBalanceDate: IsoDate;
  marginMinor: number;
  isLimiting: boolean;
}

export interface CashFlowReconciliation {
  startingNetSpendableMinor: number;
  positiveProjectedDeltaMinor: number;
  projectedCashImpactingObligationsMinor: number;
  closingBalanceMinor: number;
}

export interface CashFlowProjection {
  asOfDate: IsoDate;
  horizonEndDate: IsoDate;
  segments: ProjectionSegment[];
  events: ProjectedCashEvent[];
  days: ProjectedCashFlowDay[];
  excludedIncome: ExcludedProjectedIncome[];
  assumptions: string[];
  closingBalanceMinor: number;
  lowestProjectedBalanceMinor: number;
  lowestProjectedBalanceDate: IsoDate;
  firstBelowBufferDate?: IsoDate;
  bufferAssessments: CashFlowBufferAssessment[];
  limitingSegmentId?: string;
  reconciliation: CashFlowReconciliation;
}

export interface CashFlowProjectionInput {
  snapshot: BluehourSnapshot;
  cycle: BudgetCycle;
  asOfDate: IsoDate;
  horizonEndDate: IsoDate;
}

export interface ProjectionSegmentDraft {
  id: string;
  cycle: BudgetCycle;
  startDate: IsoDate;
  endDate: IsoDate;
  isVirtual: boolean;
}

interface SegmentBuildResult {
  segment: ProjectionSegment;
  events: ProjectedCashEvent[];
  excludedIncome: ExcludedProjectedIncome[];
  assumptions: string[];
  closingBalanceMinor: number;
}

export function calculateCashFlowProjection(input: CashFlowProjectionInput): CashFlowProjection {
  const startingNetSpendableMinor = calculateStartingNetSpendable(input);
  const segmentDrafts = createProjectionSegmentDrafts(input.snapshot, input.cycle, input.asOfDate, input.horizonEndDate);
  const segments: ProjectionSegment[] = [];
  const events: ProjectedCashEvent[] = [];
  const excludedIncome: ExcludedProjectedIncome[] = [];
  const assumptions: string[] = [];
  let openingBalanceMinor = startingNetSpendableMinor;

  for (const draft of segmentDrafts) {
    const result = buildSegment(input, draft, openingBalanceMinor);
    segments.push(result.segment);
    events.push(...result.events);
    excludedIncome.push(...result.excludedIncome);
    assumptions.push(...result.assumptions);
    openingBalanceMinor = result.closingBalanceMinor;
  }

  const days = buildProjectedDays(input.asOfDate, input.horizonEndDate, segments, events);
  const lowest = days.reduce((currentLowest, day) => (day.balanceMinor < currentLowest.balanceMinor ? day : currentLowest), days[0]);
  const bufferAssessments = buildBufferAssessments(segments, days);
  const limitingSegment = bufferAssessments.find((assessment) => assessment.isLimiting);
  const positiveProjectedDeltaMinor = events.filter((event) => event.deltaMinor > 0).reduce((total, event) => total + event.deltaMinor, 0);
  const projectedCashImpactingObligationsMinor = events
    .filter((event) => event.deltaMinor < 0)
    .reduce((total, event) => total + Math.abs(event.deltaMinor), 0);

  return {
    asOfDate: input.asOfDate,
    horizonEndDate: input.horizonEndDate,
    segments,
    events,
    days,
    excludedIncome,
    assumptions,
    closingBalanceMinor: days.at(-1)?.balanceMinor ?? startingNetSpendableMinor,
    lowestProjectedBalanceMinor: lowest?.balanceMinor ?? startingNetSpendableMinor,
    lowestProjectedBalanceDate: lowest?.date ?? input.asOfDate,
    firstBelowBufferDate: days.find((day) => day.isBelowBuffer)?.date,
    bufferAssessments,
    limitingSegmentId: limitingSegment?.segmentId,
    reconciliation: {
      startingNetSpendableMinor,
      positiveProjectedDeltaMinor,
      projectedCashImpactingObligationsMinor,
      closingBalanceMinor: days.at(-1)?.balanceMinor ?? startingNetSpendableMinor
    }
  };
}

export function createProjectionSegmentDrafts(
  snapshot: BluehourSnapshot,
  activeCycle: BudgetCycle,
  asOfDate: IsoDate,
  horizonEndDate: IsoDate
): ProjectionSegmentDraft[] {
  const salaryDate = activeCycle.expectedNextSalaryTo;
  if (compareIsoDate(horizonEndDate, salaryDate) < 0) {
    return [
      {
        id: activeCycle.id,
        cycle: activeCycle,
        startDate: asOfDate,
        endDate: horizonEndDate,
        isVirtual: false
      }
    ];
  }

  const currentEndDate = addDays(salaryDate, -1);
  const drafts: ProjectionSegmentDraft[] = [];
  if (compareIsoDate(asOfDate, currentEndDate) <= 0) {
    drafts.push({
      id: activeCycle.id,
      cycle: activeCycle,
      startDate: asOfDate,
      endDate: currentEndDate,
      isVirtual: false
    });
  }

  const virtualCycle = createVirtualFutureCycle(activeCycle, salaryDate, projectedSalaryMinor(snapshot.planInstances, activeCycle));
  drafts.push({
    id: virtualCycle.id,
    cycle: virtualCycle,
    startDate: salaryDate,
    endDate: horizonEndDate,
    isVirtual: true
  });
  return drafts;
}

export function createVirtualFutureCycle(currentCycle: BudgetCycle, salaryDate: IsoDate, salaryMinor: number): BudgetCycle {
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

export function cloneAllocationsForVirtualCycle(
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

export function projectedSalaryMinor(planInstances: readonly PlanInstance[], activeCycle: BudgetCycle): number {
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

function buildSegment(input: CashFlowProjectionInput, draft: ProjectionSegmentDraft, openingBalanceMinor: number): SegmentBuildResult {
  const allocations = draft.isVirtual
    ? [...input.snapshot.budgetAllocations, ...cloneAllocationsForVirtualCycle(input.cycle.id, draft.cycle.id, input.snapshot.budgetAllocations)]
    : input.snapshot.budgetAllocations;
  const categoryById = new Map(input.snapshot.categories.filter((category) => isActive(category) && category.active).map((category) => [category.id, category]));
  const planEvents = buildPlanEvents(input, draft, categoryById);
  const subscriptionEvents = buildSubscriptionEvents(input.snapshot.subscriptions, input.snapshot.recurringRules, input.snapshot.planInstances, draft, categoryById);
  const essential = buildEssentialDistributionEvents(input, draft, categoryById, allocations, [...planEvents, ...subscriptionEvents]);
  const protectedResult = buildProtectedContributionEvents(input, draft, allocations, [...planEvents, ...subscriptionEvents]);
  const incomeResult = buildIncomeEvents(input.snapshot.planInstances, draft, input.asOfDate, input.cycle);
  const salaryEvents = draft.isVirtual
    ? [
        {
          id: `virtual-main-salary-${draft.cycle.id}-${draft.startDate}`,
          date: draft.startDate,
          deltaMinor: draft.cycle.actualMainSalaryMinor,
          label: "Projected main salary",
          kind: "income" as const,
          sourceId: draft.cycle.salaryTransactionId,
          isAssumption: true
        }
      ]
    : [];
  const events = sortCashEvents([...salaryEvents, ...incomeResult.events, ...planEvents, ...subscriptionEvents, ...essential.events, ...protectedResult.events]);
  const closingBalanceMinor = openingBalanceMinor + events.reduce((total, event) => total + event.deltaMinor, 0);
  const committedReserveMinor = events
    .filter((event) => event.kind === "committed_expense")
    .reduce((total, event) => total + Math.abs(event.deltaMinor), 0);
  const essentialReserveMinor = [...essential.reserveLines].reduce((total, line) => total + line.amountMinor, 0);
  const bufferBaseMinor = committedReserveMinor + essentialReserveMinor;
  const bufferThresholdMinor = Math.max(draft.cycle.bufferMinimumMinor, percentageOfMinor(bufferBaseMinor, draft.cycle.bufferEssentialRateBasisPoints));

  return {
    segment: {
      id: draft.id,
      cycle: draft.cycle,
      startDate: draft.startDate,
      endDate: draft.endDate,
      openingBalanceMinor,
      bufferThresholdMinor,
      protectedTargetMinor: protectedResult.protectedTargetMinor,
      protectedReserveMinor: protectedResult.protectedReserveMinor,
      essentialReserveMinor,
      committedReserveMinor,
      isVirtual: draft.isVirtual
    },
    events,
    excludedIncome: incomeResult.excludedIncome,
    assumptions: [
      ...incomeResult.excludedIncome.map((income) => `${income.label} on ${income.date} is possible income and is excluded from projected cash.`),
      ...essential.assumptions,
      ...protectedResult.assumptions,
      ...(draft.isVirtual ? ["Projected salary starts an estimated next salary cycle using the current approved budget template."] : [])
    ],
    closingBalanceMinor
  };
}

function buildIncomeEvents(
  plans: readonly PlanInstance[],
  draft: ProjectionSegmentDraft,
  asOfDate: IsoDate,
  activeCycle: BudgetCycle
): { events: ProjectedCashEvent[]; excludedIncome: ExcludedProjectedIncome[] } {
  const events: ProjectedCashEvent[] = [];
  const excludedIncome: ExcludedProjectedIncome[] = [];

  plans
    .filter(
      (plan) =>
        isActive(plan) &&
        plan.kind === "income" &&
        plan.status === "scheduled" &&
        isWithinInclusive(plan.expectedDate, draft.startDate, draft.endDate)
    )
    .forEach((plan) => {
      if (plan.isMainSalaryEstimate && isWithinInclusive(plan.expectedDate, activeCycle.expectedNextSalaryFrom, activeCycle.expectedNextSalaryTo)) {
        return;
      }

      if (plan.confidence === "confirmed" && (draft.isVirtual || compareIsoDate(plan.expectedDate, asOfDate) > 0)) {
        events.push({
          id: `income-${draft.id}-${plan.id}`,
          date: plan.expectedDate,
          deltaMinor: plan.expectedAmountMinor,
          label: plan.name,
          kind: "income",
          sourceId: plan.id,
          accountId: plan.accountId,
          isAssumption: false
        });
        return;
      }

      excludedIncome.push({
        id: `excluded-income-${draft.id}-${plan.id}`,
        date: plan.expectedDate,
        amountMinor: plan.expectedAmountMinor,
        label: plan.name,
        confidence: plan.confidence,
        sourceId: plan.id
      });
    });

  return { events, excludedIncome };
}

function buildPlanEvents(
  input: CashFlowProjectionInput,
  draft: ProjectionSegmentDraft,
  categoryById: Map<string, Category>
): ProjectedCashEvent[] {
  return input.snapshot.planInstances
    .filter(
      (plan) =>
        isActive(plan) &&
        plan.kind !== "income" &&
        plan.status === "scheduled" &&
        plan.reservation === "reserved" &&
        isWithinInclusive(plan.expectedDate, draft.startDate, draft.endDate)
    )
    .flatMap((plan) => eventForPlan(input.snapshot.accounts, input.snapshot.recurringRules, plan, draft, categoryById));
}

function eventForPlan(
  accounts: readonly Account[],
  recurringRules: readonly RecurringRule[],
  plan: PlanInstance,
  draft: ProjectionSegmentDraft,
  categoryById: Map<string, Category>
): ProjectedCashEvent[] {
  const category = plan.categoryId ? categoryById.get(plan.categoryId) : undefined;

  if (plan.kind === "transfer") {
    const transfer = transferImpactForPlan(accounts, recurringRules, plan);
    if (!transfer) {
      return [];
    }
    return [
      {
        id: `transfer-plan-${draft.id}-${plan.id}`,
        date: plan.expectedDate,
        deltaMinor: transfer.deltaMinor,
        label: plan.name,
        kind: transfer.deltaMinor === 0 ? "internal_transfer" : "protected_transfer",
        sourceId: plan.id,
        categoryId: plan.categoryId,
        accountId: transfer.fromAccountId,
        isAssumption: false
      }
    ];
  }

  if (!category) {
    return [];
  }

  const kind: ProjectedCashEventKind =
    category.reservationMode === "plan"
      ? "committed_expense"
      : category.nature === "essential"
        ? "essential_plan"
        : "discretionary_plan";

  return [
    {
      id: `plan-${draft.id}-${plan.id}`,
      date: plan.expectedDate,
      deltaMinor: -plan.expectedAmountMinor,
      label: plan.name,
      kind,
      sourceId: plan.id,
      categoryId: plan.categoryId,
      accountId: plan.accountId,
      isAssumption: plan.confidence === "expected"
    }
  ];
}

function buildSubscriptionEvents(
  subscriptions: readonly Subscription[],
  recurringRules: readonly RecurringRule[],
  plans: readonly PlanInstance[],
  draft: ProjectionSegmentDraft,
  categoryById: Map<string, Category>
): ProjectedCashEvent[] {
  return subscriptions
    .filter((subscription) => isActive(subscription) && isWithinInclusive(subscription.nextPaymentDate, draft.startDate, draft.endDate))
    .flatMap((subscription) => {
      const rule = recurringRules.find((item) => item.id === subscription.recurringRuleId && isActive(item));
      if (!rule) {
        return [];
      }

      const representedByPlan = plans.some(
        (plan) =>
          isActive(plan) &&
          plan.status === "scheduled" &&
          plan.expectedDate === subscription.nextPaymentDate &&
          (plan.recurringRuleId === subscription.recurringRuleId ||
            (plan.name === subscription.provider && plan.expectedAmountMinor === rule.amountMinor))
      );
      if (representedByPlan) {
        return [];
      }

      const category = rule.categoryId ? categoryById.get(rule.categoryId) : undefined;
      const kind: ProjectedCashEventKind = category?.reservationMode === "plan" ? "committed_expense" : "discretionary_plan";
      return [
        {
          id: `subscription-${draft.id}-${subscription.id}-${subscription.nextPaymentDate}`,
          date: subscription.nextPaymentDate,
          deltaMinor: -rule.amountMinor,
          label: subscription.provider,
          kind,
          sourceId: subscription.id,
          categoryId: rule.categoryId,
          accountId: rule.fromAccountId,
          isAssumption: true
        }
      ];
    });
}

function buildEssentialDistributionEvents(
  input: CashFlowProjectionInput,
  draft: ProjectionSegmentDraft,
  categoryById: Map<string, Category>,
  allocations: readonly BudgetAllocation[],
  representedEvents: readonly ProjectedCashEvent[]
): {
  events: ProjectedCashEvent[];
  reserveLines: Array<{ categoryId: string; amountMinor: number }>;
  assumptions: string[];
} {
  const activeCategories = [...categoryById.values()];
  const events: ProjectedCashEvent[] = [];
  const reserveLines: Array<{ categoryId: string; amountMinor: number }> = [];
  const assumptions: string[] = [];

  for (const category of activeCategories.filter((item) => item.nature === "essential" && item.reservationMode === "envelope")) {
    const allocation = calculateCategoryAllocation(category.id, draft.cycle, allocations, input.snapshot.budgetTransfers);
    const spent = draft.isVirtual
      ? 0
      : calculateCategoryActuals(category.id, input.snapshot.transactions, input.snapshot.transactionSplits, draft.cycle.startedOn, input.asOfDate);
    const remainingAllocation = calculateRemainingAllocation(allocation, spent);
    const representedDatedPlansMinor = representedEvents
      .filter((event) => event.categoryId === category.id && event.kind === "essential_plan")
      .reduce((total, event) => total + Math.abs(event.deltaMinor), 0);
    const planReserve = input.snapshot.planInstances
      .filter(
        (plan) =>
          isActive(plan) &&
          plan.kind !== "income" &&
          plan.reservation === "reserved" &&
          plan.status === "scheduled" &&
          plan.categoryId === category.id &&
          isWithinInclusive(plan.expectedDate, draft.startDate, draft.endDate)
      )
      .reduce((total, plan) => total + plan.expectedAmountMinor, 0);
    const reserveMinor = Math.max(remainingAllocation, planReserve);
    const undatedMinor = clampNonNegative(reserveMinor - representedDatedPlansMinor);
    reserveLines.push({ categoryId: category.id, amountMinor: reserveMinor });

    if (undatedMinor <= 0) {
      continue;
    }

    assumptions.push(`${category.name} reserve is distributed with integer sen across remaining applicable days; any remainder sen lands on the final day.`);
    events.push(...distributeMinorAcrossDays(`essential-distribution-${draft.id}-${category.id}`, draft.startDate, draft.endDate, -undatedMinor, category.name, category.id));
  }

  return { events, reserveLines, assumptions };
}

function buildProtectedContributionEvents(
  input: CashFlowProjectionInput,
  draft: ProjectionSegmentDraft,
  allocations: readonly BudgetAllocation[],
  representedEvents: readonly ProjectedCashEvent[]
): {
  events: ProjectedCashEvent[];
  protectedTargetMinor: number;
  protectedReserveMinor: number;
  assumptions: string[];
} {
  void allocations;
  const protectedTargetMinor =
    percentageOfMinor(draft.cycle.actualMainSalaryMinor, draft.cycle.protectedRateBasisPoints) +
    (draft.cycle.additionalProtectedCommitmentMinor ?? 0);
  const completedProtectedMinor = draft.isVirtual ? 0 : calculateCompletedProtectedTransfers(input, draft.cycle, input.asOfDate);
  const plannedProtectedMinor = representedEvents
    .filter((event) => event.kind === "protected_transfer" && event.deltaMinor < 0)
    .reduce((total, event) => total + Math.abs(event.deltaMinor), 0);
  const protectedReserveMinor = clampNonNegative(protectedTargetMinor - completedProtectedMinor);
  const outstandingMinor = clampNonNegative(protectedReserveMinor - plannedProtectedMinor);
  if (outstandingMinor <= 0) {
    return { events: [], protectedTargetMinor, protectedReserveMinor, assumptions: [] };
  }

  const date = draft.isVirtual ? draft.startDate : draft.startDate;
  return {
    events: [
      {
        id: `protected-assumption-${draft.id}-${date}`,
        date,
        deltaMinor: -outstandingMinor,
        label: "Assumed protected contribution",
        kind: "protected_transfer",
        isAssumption: true
      }
    ],
    protectedTargetMinor,
    protectedReserveMinor,
    assumptions: ["Outstanding protected reserve is shown as an assumed transfer, not an actual scheduled bank transfer."]
  };
}

function calculateCompletedProtectedTransfers(input: CashFlowProjectionInput, cycle: BudgetCycle, asOfDate: IsoDate): number {
  const protectedAccountIds = new Set(
    input.snapshot.accounts.filter((account) => isActive(account) && account.role === "protected").map((account) => account.id)
  );
  const transactionById = new Map(input.snapshot.transactions.filter(isActive).map((transaction) => [transaction.id, transaction]));

  return input.snapshot.transactionLegs
    .filter((leg) => {
      const transaction = transactionById.get(leg.transactionId);
      return (
        isActive(leg) &&
        protectedAccountIds.has(leg.accountId) &&
        leg.deltaMinor > 0 &&
        transaction?.type === "transfer" &&
        isWithinInclusive(transaction.occurredOn, cycle.startedOn, asOfDate)
      );
    })
    .reduce((total, leg) => total + leg.deltaMinor, 0);
}

function transferImpactForPlan(
  accounts: readonly Account[],
  recurringRules: readonly RecurringRule[],
  plan: PlanInstance
): { deltaMinor: number; fromAccountId: string; toAccountId: string } | null {
  const rule = plan.recurringRuleId ? recurringRules.find((item) => item.id === plan.recurringRuleId) : undefined;
  const fromAccountId = plan.fromAccountId ?? rule?.fromAccountId ?? plan.accountId;
  const toAccountId = plan.toAccountId ?? rule?.toAccountId;
  if (!fromAccountId || !toAccountId) {
    return null;
  }

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const fromWeight = spendableWealthWeight(accountById.get(fromAccountId));
  const toWeight = spendableWealthWeight(accountById.get(toAccountId));
  return {
    deltaMinor: plan.expectedAmountMinor * toWeight - plan.expectedAmountMinor * fromWeight,
    fromAccountId,
    toAccountId
  };
}

function spendableWealthWeight(account: Account | undefined): 0 | 1 {
  if (!account || !isActive(account)) {
    return 0;
  }

  return account.role === "spendable" || account.type === "credit_card" ? 1 : 0;
}

function distributeMinorAcrossDays(
  idPrefix: string,
  startDate: IsoDate,
  endDate: IsoDate,
  totalDeltaMinor: number,
  label: string,
  categoryId: string
): ProjectedCashEvent[] {
  const days = daysBetweenInclusive(startDate, endDate);
  const absoluteTotal = Math.abs(totalDeltaMinor);
  const sign = totalDeltaMinor < 0 ? -1 : 1;
  const daily = Math.floor(absoluteTotal / days);
  const remainder = absoluteTotal % days;

  return Array.from({ length: days }, (_, index) => {
    const date = addDays(startDate, index);
    const amount = daily + (index === days - 1 ? remainder : 0);
    return {
      id: `${idPrefix}-${date}`,
      date,
      deltaMinor: sign * amount,
      label: `${label} reserve`,
      kind: "essential_distribution" as const,
      categoryId,
      isAssumption: true
    };
  }).filter((event) => event.deltaMinor !== 0);
}

function buildProjectedDays(
  asOfDate: IsoDate,
  horizonEndDate: IsoDate,
  segments: readonly ProjectionSegment[],
  events: readonly ProjectedCashEvent[]
): ProjectedCashFlowDay[] {
  const eventsByDate = new Map<IsoDate, ProjectedCashEvent[]>();
  for (const event of events) {
    const grouped = eventsByDate.get(event.date) ?? [];
    grouped.push(event);
    eventsByDate.set(event.date, grouped);
  }

  const days: ProjectedCashFlowDay[] = [];
  let balanceMinor = segments[0]?.openingBalanceMinor ?? 0;
  let activeSegment = segments[0];

  for (let offset = 0; offset < daysBetweenInclusive(asOfDate, horizonEndDate); offset += 1) {
    const date = addDays(asOfDate, offset);
    const nextSegment = segments.find((segment) => isWithinInclusive(date, segment.startDate, segment.endDate));
    if (nextSegment && nextSegment.id !== activeSegment?.id) {
      activeSegment = nextSegment;
      balanceMinor = nextSegment.openingBalanceMinor;
    }

    const dayEvents = sortCashEvents(eventsByDate.get(date) ?? []);
    balanceMinor += dayEvents.reduce((total, event) => total + event.deltaMinor, 0);
    days.push({
      date,
      balanceMinor,
      events: dayEvents,
      segmentId: activeSegment?.id ?? "",
      bufferThresholdMinor: activeSegment?.bufferThresholdMinor ?? 0,
      isLowest: false,
      isBelowBuffer: activeSegment ? balanceMinor < activeSegment.bufferThresholdMinor : false
    });
  }

  const lowest = days.reduce((currentLowest, day) => (day.balanceMinor < currentLowest.balanceMinor ? day : currentLowest), days[0]);
  return days.map((day) => ({ ...day, isLowest: day.date === lowest?.date && day.segmentId === lowest.segmentId }));
}

function buildBufferAssessments(
  segments: readonly ProjectionSegment[],
  days: readonly ProjectedCashFlowDay[]
): CashFlowBufferAssessment[] {
  const assessments = segments.map((segment) => {
    const segmentDays = days.filter((day) => day.segmentId === segment.id);
    const lowest = segmentDays.reduce((currentLowest, day) => (day.balanceMinor < currentLowest.balanceMinor ? day : currentLowest), segmentDays[0]);
    return {
      segmentId: segment.id,
      startDate: segment.startDate,
      endDate: segment.endDate,
      bufferThresholdMinor: segment.bufferThresholdMinor,
      lowestBalanceMinor: lowest?.balanceMinor ?? segment.openingBalanceMinor,
      lowestBalanceDate: lowest?.date ?? segment.startDate,
      marginMinor: (lowest?.balanceMinor ?? segment.openingBalanceMinor) - segment.bufferThresholdMinor,
      isLimiting: false
    };
  });
  const limiting = assessments.reduce((current, assessment) => (assessment.marginMinor < current.marginMinor ? assessment : current), assessments[0]);
  return assessments.map((assessment) => ({ ...assessment, isLimiting: assessment.segmentId === limiting?.segmentId }));
}

function calculateStartingNetSpendable(input: CashFlowProjectionInput): number {
  const accountBalances = calculateAccountBalances(
    input.snapshot.accounts,
    input.snapshot.balanceSnapshots,
    input.snapshot.transactions,
    input.snapshot.transactionLegs,
    input.asOfDate
  );
  return calculateNetSpendableBalance(accountBalances);
}

function sortCashEvents(events: readonly ProjectedCashEvent[]): ProjectedCashEvent[] {
  return [...events].sort((left, right) => compareIsoDate(left.date, right.date) || left.id.localeCompare(right.id));
}
