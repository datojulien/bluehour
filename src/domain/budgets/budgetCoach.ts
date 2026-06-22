import { isWithinInclusive } from "../dates";
import { percentageOfMinor, sumMinor } from "../money";
import { calculateCategoryActuals } from "../transactions/calculations";
import type {
  BluehourSnapshot,
  BudgetAllocation,
  BudgetCycle,
  Category,
  IsoDate,
  PlanInstance,
  Subscription,
  Transaction,
  TransactionSplit
} from "../types";
import { isActive } from "../types";

export type BudgetCoachProfileId = "flexible" | "balanced" | "secure";
export type BudgetCoachPriority = "low" | "normal" | "high";
export type RecommendationConfidence = "estimated" | "observed" | "reliable";

export interface EssentialCategoryPreference {
  categoryId: string;
  minimumMinor: number;
  comfortableMinor: number;
  priority: BudgetCoachPriority;
}

export interface DiscretionaryCategoryPreference {
  categoryId: string;
  enabled: boolean;
  priority: BudgetCoachPriority;
}

export interface BudgetCoachCommitment {
  id: string;
  label: string;
  amountMinor: number;
  categoryId?: string;
  dueDate?: IsoDate;
  optional?: boolean;
  source: "plan" | "subscription" | "manual";
}

export interface HistoricalCategoryActual {
  categoryId: string;
  cycleId: string;
  amountMinor: number;
  cycleEndedOn?: IsoDate;
}

export interface BudgetCoachScenarioIncome {
  id: string;
  label: string;
  amountMinor: number;
  confidence: "confirmed" | "possible";
}

export interface BudgetCoachInput {
  salaryMinor: number;
  cycleStartDate?: IsoDate;
  cycleEndDate?: IsoDate;
  profileId: BudgetCoachProfileId;
  configuredMinimumProtectedRateBasisPoints: number;
  bufferMinimumMinor: number;
  bufferEssentialRateBasisPoints: number;
  commitments: readonly BudgetCoachCommitment[];
  essentialPreferences: readonly EssentialCategoryPreference[];
  discretionaryPreferences: readonly DiscretionaryCategoryPreference[];
  currentAllocations?: readonly BudgetAllocation[];
  historicalCategoryActuals?: readonly HistoricalCategoryActual[];
  scenarioIncome?: readonly BudgetCoachScenarioIncome[];
}

export interface BudgetCoachCategoryRecommendation {
  categoryId: string;
  currentAmountMinor?: number;
  suggestedAmountMinor: number;
  minimumMinor?: number;
  comfortableMinor?: number;
  salaryPercentageBasisPoints: number;
  confidence: RecommendationConfidence;
  explanation: string[];
}

export interface BudgetCoachGroupRecommendation {
  id: "committed" | "essential" | "protected" | "buffer" | "discretionary" | "unallocated";
  label: string;
  amountMinor: number;
  salaryPercentageBasisPoints: number;
  confidence: RecommendationConfidence;
  explanation: string[];
}

export interface BudgetCoachResult {
  profileId: BudgetCoachProfileId;
  salaryMinor: number;
  committedMinor: number;
  essentialMinimumMinor: number;
  essentialSuggestedMinor: number;
  protectedTargetMinor: number;
  protectedRateBasisPoints: number;
  selectedProtectedRateBasisPoints: number;
  configuredMinimumProtectedRateBasisPoints: number;
  bufferMinor: number;
  discretionaryMinor: number;
  unallocatedMinor: number;
  shortfallMinor: number;
  feasible: boolean;
  limitingReason?: string;
  confidence: RecommendationConfidence;
  groupRecommendations: BudgetCoachGroupRecommendation[];
  categoryRecommendations: BudgetCoachCategoryRecommendation[];
  excludedScenarioIncome: BudgetCoachScenarioIncome[];
  explanations: string[];
  warnings: string[];
}

export interface BudgetCoachPreferences {
  profileId: BudgetCoachProfileId;
  essentialPreferences: EssentialCategoryPreference[];
  discretionaryPreferences: DiscretionaryCategoryPreference[];
  acceptedDecisions?: BudgetCoachDecision[];
}

export interface BudgetCoachDecision {
  id: string;
  acceptedAt: string;
  cycleId?: string;
  profileId: BudgetCoachProfileId;
  confidence: RecommendationConfidence;
  appliedCategoryIds: string[];
}

export const BUDGET_COACH_PROFILES: Record<
  BudgetCoachProfileId,
  { label: string; protectedRateBasisPoints: number; purpose: string }
> = {
  flexible: {
    label: "Flexible",
    protectedRateBasisPoints: 1_000,
    purpose: "Preserves the minimum protected contribution and leaves more room for discretionary spending."
  },
  balanced: {
    label: "Balanced",
    protectedRateBasisPoints: 1_500,
    purpose: "Balances moderate protection with day-to-day flexibility."
  },
  secure: {
    label: "Secure",
    protectedRateBasisPoints: 2_000,
    purpose: "Builds protected funds more quickly when commitments and essentials allow it."
  }
};

const PRIORITY_WEIGHTS: Record<BudgetCoachPriority, number> = {
  low: 1,
  normal: 2,
  high: 3
};

export function recommendBudget(input: BudgetCoachInput): BudgetCoachResult {
  validateInput(input);

  const confidence = confidenceFromHistory(input.historicalCategoryActuals ?? []);
  const currentAllocationByCategory = new Map(
    (input.currentAllocations ?? [])
      .filter(isActive)
      .map((allocation) => [allocation.categoryId, allocation.baseAmountMinor])
  );
  const commitments = uniqueCommitments(input.commitments);
  const committedMinor = sumMinor(commitments.map((commitment) => commitment.amountMinor));
  const essentialMinimumMinor = sumMinor(input.essentialPreferences.map((preference) => preference.minimumMinor));
  const selectedProtectedRateBasisPoints = Math.max(
    BUDGET_COACH_PROFILES[input.profileId].protectedRateBasisPoints,
    input.configuredMinimumProtectedRateBasisPoints
  );
  const selectedProtectedTargetMinor = percentageOfMinor(input.salaryMinor, selectedProtectedRateBasisPoints);
  const minimumProtectedTargetMinor = percentageOfMinor(input.salaryMinor, input.configuredMinimumProtectedRateBasisPoints);
  const bufferMinor = Math.max(
    input.bufferMinimumMinor,
    percentageOfMinor(committedMinor + essentialMinimumMinor, input.bufferEssentialRateBasisPoints)
  );
  const affordableProtectedMinor = input.salaryMinor - committedMinor - essentialMinimumMinor - bufferMinor;
  const protectedTargetMinor =
    selectedProtectedTargetMinor > affordableProtectedMinor
      ? minimumProtectedTargetMinor <= affordableProtectedMinor
        ? Math.max(minimumProtectedTargetMinor, affordableProtectedMinor)
        : minimumProtectedTargetMinor
      : selectedProtectedTargetMinor;
  const protectedRateBasisPoints = basisPointsOf(input.salaryMinor, protectedTargetMinor);
  const minimumPlanMinor = committedMinor + essentialMinimumMinor + protectedTargetMinor + bufferMinor;
  const baseAfterMinimums = input.salaryMinor - minimumPlanMinor;
  const feasible = baseAfterMinimums >= 0;
  const warnings: string[] = [];
  const explanations: string[] = [];

  if (selectedProtectedTargetMinor > affordableProtectedMinor && minimumProtectedTargetMinor <= affordableProtectedMinor) {
    explanations.push(
      `${BUDGET_COACH_PROFILES[input.profileId].label} was adjusted from ${selectedProtectedRateBasisPoints} basis points to ${protectedRateBasisPoints} basis points because current commitments, essential minimums, and the safety buffer leave less room.`
    );
  }

  if (selectedProtectedTargetMinor > affordableProtectedMinor && minimumProtectedTargetMinor > affordableProtectedMinor) {
    warnings.push("The configured minimum protected contribution does not fit after commitments, essential minimums, and the safety buffer.");
  }

  if (!feasible) {
    warnings.push("Minimum commitments, essential needs, protected contribution, and buffer exceed main salary.");
  }

  for (const income of input.scenarioIncome ?? []) {
    explanations.push(`${income.label} is excluded from the recurring base budget and can be reviewed as a separate allocation choice.`);
  }

  const historicalByCategory = historicalMediansByCategory(input.historicalCategoryActuals ?? []);
  const essentialTargets = input.essentialPreferences.map((preference, index) => {
    const median = historicalByCategory.get(preference.categoryId);
    const historicalTargetMinor = median ? roundToNearestMinor(median.medianMinor, 1_000) : undefined;
    const targetMinor = historicalTargetMinor ? Math.max(preference.comfortableMinor, historicalTargetMinor) : preference.comfortableMinor;
    if (median && median.medianMinor > preference.comfortableMinor) {
      warnings.push(
        `${preference.categoryId} recent spending has been above the comfortable estimate. Review whether the estimate or spending behaviour has changed.`
      );
    }

    return {
      id: preference.categoryId,
      categoryId: preference.categoryId,
      minimumMinor: preference.minimumMinor,
      comfortableMinor: preference.comfortableMinor,
      targetMinor,
      priority: preference.priority,
      weight: PRIORITY_WEIGHTS[preference.priority],
      sortIndex: index,
      historicalMedianMinor: median?.medianMinor,
      confidence: confidenceFromCount(median?.cycleCount ?? 0)
    };
  });

  const essentialBase = Object.fromEntries(essentialTargets.map((target) => [target.categoryId, target.minimumMinor]));
  const essentialTopUp = feasible
    ? allocateWeightedCapped(
        baseAfterMinimums,
        essentialTargets.map((target) => ({
          id: target.categoryId,
          maxMinor: Math.max(0, target.targetMinor - target.minimumMinor),
          weight: target.weight,
          priority: target.priority,
          sortIndex: target.sortIndex
        }))
      )
    : {};
  const essentialSuggestedByCategory = new Map(
    essentialTargets.map((target) => [
      target.categoryId,
      essentialBase[target.categoryId] + (essentialTopUp[target.categoryId] ?? 0)
    ])
  );
  const essentialSuggestedMinor = sumMinor([...essentialSuggestedByCategory.values()]);
  const afterEssentialComfort = feasible ? baseAfterMinimums - (essentialSuggestedMinor - essentialMinimumMinor) : 0;
  const enabledDiscretionary = input.discretionaryPreferences
    .map((preference, index) => {
      const median = historicalByCategory.get(preference.categoryId);
      return {
        id: preference.categoryId,
        categoryId: preference.categoryId,
        enabled: preference.enabled,
        priority: preference.priority,
        weight: PRIORITY_WEIGHTS[preference.priority],
        sortIndex: index,
        historicalMedianMinor: median?.medianMinor,
        confidence: confidenceFromCount(median?.cycleCount ?? 0)
      };
    })
    .filter((preference) => preference.enabled);

  const discretionaryBaseTargets = enabledDiscretionary.map((preference) => ({
    id: preference.categoryId,
    maxMinor: preference.historicalMedianMinor ? Math.max(0, roundToNearestMinor(preference.historicalMedianMinor, 1_000)) : Number.MAX_SAFE_INTEGER,
    weight: preference.historicalMedianMinor ? Math.max(1, preference.historicalMedianMinor) : preference.weight,
    priority: preference.priority,
    sortIndex: preference.sortIndex
  }));
  const discretionaryAllocation =
    feasible && enabledDiscretionary.length > 0
      ? allocateWeightedCapped(afterEssentialComfort, discretionaryBaseTargets)
      : {};
  const discretionaryMinor = sumMinor(Object.values(discretionaryAllocation));
  const unallocatedMinor = feasible ? Math.max(0, afterEssentialComfort - discretionaryMinor) : 0;
  const shortfallMinor = feasible ? 0 : Math.abs(baseAfterMinimums);

  const essentialRecommendations: BudgetCoachCategoryRecommendation[] = essentialTargets.map((target) => {
    const suggestedAmountMinor = essentialSuggestedByCategory.get(target.categoryId) ?? target.minimumMinor;
    const explanation = [
      `Minimum is preserved at ${target.minimumMinor} sen and comfortable is ${target.comfortableMinor} sen.`,
      `${priorityLabel(target.priority)} priority uses weight ${target.weight}.`
    ];
    const topUp = suggestedAmountMinor - target.minimumMinor;
    if (topUp > 0) {
      explanation.push(`Available money filled ${topUp} sen of this category's comfort gap.`);
    }
    if (target.historicalMedianMinor !== undefined) {
      explanation.push(`Recent completed-cycle median is ${target.historicalMedianMinor} sen before any RM10 display rounding.`);
    } else {
      explanation.push("No completed-cycle history is available yet.");
    }

    return {
      categoryId: target.categoryId,
      currentAmountMinor: currentAllocationByCategory.get(target.categoryId),
      suggestedAmountMinor,
      minimumMinor: target.minimumMinor,
      comfortableMinor: target.comfortableMinor,
      salaryPercentageBasisPoints: basisPointsOf(input.salaryMinor, suggestedAmountMinor),
      confidence: target.confidence,
      explanation
    };
  });

  const discretionaryRecommendations: BudgetCoachCategoryRecommendation[] = input.discretionaryPreferences.map((preference, index) => {
    const median = historicalByCategory.get(preference.categoryId);
    const suggestedAmountMinor = preference.enabled ? discretionaryAllocation[preference.categoryId] ?? 0 : 0;
    const explanation = preference.enabled
      ? [
          `Discretionary allocation uses ${priorityLabel(preference.priority)} priority with weight ${PRIORITY_WEIGHTS[preference.priority]}.`,
          median
            ? `Recent completed-cycle median is ${median.medianMinor} sen before scaling to fit the available pool.`
            : "No completed-cycle history is available yet."
        ]
      : ["This discretionary category is disabled, so it receives RM0.00."];

    return {
      categoryId: preference.categoryId,
      currentAmountMinor: currentAllocationByCategory.get(preference.categoryId),
      suggestedAmountMinor,
      salaryPercentageBasisPoints: basisPointsOf(input.salaryMinor, suggestedAmountMinor),
      confidence: preference.enabled ? confidenceFromCount(median?.cycleCount ?? 0) : "estimated",
      explanation: [...explanation, `Input order ${index + 1} is used only as a deterministic tie-breaker.`]
    };
  });

  const resultConfidence = confidence;
  const groupRecommendations: BudgetCoachGroupRecommendation[] = [
    {
      id: "committed",
      label: "Committed",
      amountMinor: committedMinor,
      salaryPercentageBasisPoints: basisPointsOf(input.salaryMinor, committedMinor),
      confidence: resultConfidence,
      explanation: [`Known commitments are reserved first from ${commitments.length} fixed or scheduled item${commitments.length === 1 ? "" : "s"}.`]
    },
    {
      id: "essential",
      label: "Essential flexible",
      amountMinor: essentialSuggestedMinor,
      salaryPercentageBasisPoints: basisPointsOf(input.salaryMinor, essentialSuggestedMinor),
      confidence: resultConfidence,
      explanation: ["Essential minimums are preserved before any comfort top-up is distributed by priority weights."]
    },
    {
      id: "protected",
      label: "Protected",
      amountMinor: protectedTargetMinor,
      salaryPercentageBasisPoints: protectedRateBasisPoints,
      confidence: resultConfidence,
      explanation: [
        `${BUDGET_COACH_PROFILES[input.profileId].label} targets ${selectedProtectedRateBasisPoints} basis points before affordability checks.`,
        `Configured minimum protected rate is ${input.configuredMinimumProtectedRateBasisPoints} basis points.`
      ]
    },
    {
      id: "buffer",
      label: "Safety buffer",
      amountMinor: bufferMinor,
      salaryPercentageBasisPoints: basisPointsOf(input.salaryMinor, bufferMinor),
      confidence: resultConfidence,
      explanation: ["The buffer is retained unallocated cash, calculated as the greater of the configured minimum or a percentage of commitments plus essential minimums."]
    },
    {
      id: "discretionary",
      label: "Discretionary",
      amountMinor: discretionaryMinor,
      salaryPercentageBasisPoints: basisPointsOf(input.salaryMinor, discretionaryMinor),
      confidence: resultConfidence,
      explanation: ["Remaining money is distributed only to enabled discretionary categories by deterministic priority weights."]
    },
    {
      id: "unallocated",
      label: "Unallocated",
      amountMinor: unallocatedMinor,
      salaryPercentageBasisPoints: basisPointsOf(input.salaryMinor, unallocatedMinor),
      confidence: resultConfidence,
      explanation: ["Unallocated safe-to-spend is preserved instead of being silently added to another category."]
    }
  ];

  return {
    profileId: input.profileId,
    salaryMinor: input.salaryMinor,
    committedMinor,
    essentialMinimumMinor,
    essentialSuggestedMinor,
    protectedTargetMinor,
    protectedRateBasisPoints,
    selectedProtectedRateBasisPoints,
    configuredMinimumProtectedRateBasisPoints: input.configuredMinimumProtectedRateBasisPoints,
    bufferMinor,
    discretionaryMinor,
    unallocatedMinor,
    shortfallMinor,
    feasible,
    limitingReason: feasible ? undefined : "Minimum requirements exceed main salary.",
    confidence,
    groupRecommendations,
    categoryRecommendations: [...essentialRecommendations, ...discretionaryRecommendations],
    excludedScenarioIncome: [...(input.scenarioIncome ?? [])],
    explanations: [
      "Recommendations use main salary, known commitments, essential minimums, protected contribution, and the active safety-buffer rule before discretionary spending.",
      "Priority weights are Low 1, Normal 2, High 3.",
      ...explanations
    ],
    warnings
  };
}

export function buildCommitmentsForCycle({
  categories,
  planInstances,
  subscriptions,
  recurringRules,
  startDate,
  endDate
}: {
  categories: readonly Category[];
  planInstances: readonly PlanInstance[];
  subscriptions: readonly Subscription[];
  recurringRules: BluehourSnapshot["recurringRules"];
  startDate: IsoDate;
  endDate: IsoDate;
}): BudgetCoachCommitment[] {
  const categoryById = new Map(categories.filter((category) => isActive(category) && category.active).map((category) => [category.id, category]));
  const commitments: BudgetCoachCommitment[] = [];

  for (const plan of planInstances) {
    const category = plan.categoryId ? categoryById.get(plan.categoryId) : undefined;
    if (
      isActive(plan) &&
      plan.kind === "expense" &&
      plan.status === "scheduled" &&
      plan.reservation === "reserved" &&
      category?.reservationMode === "plan" &&
      isWithinInclusive(plan.expectedDate, startDate, endDate)
    ) {
      commitments.push({
        id: `plan:${plan.id}`,
        label: plan.name,
        amountMinor: plan.expectedAmountMinor,
        categoryId: plan.categoryId,
        dueDate: plan.expectedDate,
        optional: category.nature === "discretionary",
        source: "plan"
      });
    }
  }

  for (const subscription of subscriptions) {
    if (!isActive(subscription) || !isWithinInclusive(subscription.nextPaymentDate, startDate, endDate)) {
      continue;
    }

    const rule = recurringRules.find((item) => item.id === subscription.recurringRuleId && isActive(item));
    if (!rule) {
      continue;
    }

    const representedByPlan = planInstances.some(
      (plan) =>
        isActive(plan) &&
        plan.status === "scheduled" &&
        plan.expectedDate === subscription.nextPaymentDate &&
        (plan.recurringRuleId === subscription.recurringRuleId ||
          (plan.name === subscription.provider && plan.expectedAmountMinor === rule.amountMinor))
    );
    if (representedByPlan) {
      continue;
    }

    const category = rule.categoryId ? categoryById.get(rule.categoryId) : undefined;
    if (category?.reservationMode !== "plan") {
      continue;
    }

    commitments.push({
      id: `subscription:${subscription.id}:${subscription.nextPaymentDate}`,
      label: subscription.provider,
      amountMinor: rule.amountMinor,
      categoryId: rule.categoryId,
      dueDate: subscription.nextPaymentDate,
      optional: !subscription.essential,
      source: "subscription"
    });
  }

  return commitments;
}

export function buildHistoricalCategoryActuals({
  cycles,
  transactions,
  transactionSplits,
  categories,
  limit = 6
}: {
  cycles: readonly BudgetCycle[];
  transactions: readonly Transaction[];
  transactionSplits: readonly TransactionSplit[];
  categories: readonly Category[];
  limit?: number;
}): HistoricalCategoryActual[] {
  const completedCycles = cycles
    .filter((cycle) => isActive(cycle) && cycle.status === "closed" && cycle.endedOn)
    .sort((left, right) => String(right.endedOn).localeCompare(String(left.endedOn)))
    .slice(0, limit);
  const categoryIds = categories
    .filter((category) => isActive(category) && category.active && category.reservationMode === "envelope")
    .map((category) => category.id);

  return completedCycles.flatMap((cycle) =>
    categoryIds.map((categoryId) => ({
      categoryId,
      cycleId: cycle.id,
      cycleEndedOn: cycle.endedOn,
      amountMinor: calculateCategoryActuals(categoryId, transactions, transactionSplits, cycle.startedOn, cycle.endedOn ?? cycle.startedOn)
    }))
  );
}

export function defaultBudgetCoachPreferences(categories: readonly Category[]): BudgetCoachPreferences {
  return {
    profileId: "balanced",
    essentialPreferences: categories
      .filter((category) => isActive(category) && category.active && category.group === "essential_flexible")
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((category) => ({
        categoryId: category.id,
        minimumMinor: 0,
        comfortableMinor: 0,
        priority: "normal" as const
      })),
    discretionaryPreferences: categories
      .filter((category) => isActive(category) && category.active && category.group === "discretionary")
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((category) => ({
        categoryId: category.id,
        enabled: true,
        priority: "normal" as const
      })),
    acceptedDecisions: []
  };
}

export function mergeBudgetCoachPreferences(
  categories: readonly Category[],
  stored: Partial<BudgetCoachPreferences> | undefined
): BudgetCoachPreferences {
  const defaults = defaultBudgetCoachPreferences(categories);
  const essentialById = new Map((stored?.essentialPreferences ?? []).map((preference) => [preference.categoryId, preference]));
  const discretionaryById = new Map((stored?.discretionaryPreferences ?? []).map((preference) => [preference.categoryId, preference]));
  const profileId = isBudgetCoachProfileId(stored?.profileId) ? stored.profileId : defaults.profileId;

  return {
    profileId,
    essentialPreferences: defaults.essentialPreferences.map((preference) => {
      const storedPreference = essentialById.get(preference.categoryId);
      return storedPreference && isPriority(storedPreference.priority)
        ? {
            categoryId: preference.categoryId,
            minimumMinor: Math.max(0, integerOrZero(storedPreference.minimumMinor)),
            comfortableMinor: Math.max(
              Math.max(0, integerOrZero(storedPreference.minimumMinor)),
              integerOrZero(storedPreference.comfortableMinor)
            ),
            priority: storedPreference.priority
          }
        : preference;
    }),
    discretionaryPreferences: defaults.discretionaryPreferences.map((preference) => {
      const storedPreference = discretionaryById.get(preference.categoryId);
      return storedPreference && isPriority(storedPreference.priority)
        ? {
            categoryId: preference.categoryId,
            enabled: Boolean(storedPreference.enabled),
            priority: storedPreference.priority
          }
        : preference;
    }),
    acceptedDecisions: Array.isArray(stored?.acceptedDecisions) ? stored.acceptedDecisions : []
  };
}

export function recommendationTotal(result: BudgetCoachResult): number {
  return (
    result.committedMinor +
    result.essentialSuggestedMinor +
    result.protectedTargetMinor +
    result.bufferMinor +
    result.discretionaryMinor +
    result.unallocatedMinor
  );
}

export function basisPointsOf(totalMinor: number, amountMinor: number): number {
  if (totalMinor <= 0 || amountMinor <= 0) {
    return 0;
  }

  return Math.floor((amountMinor * 10_000 + Math.floor(totalMinor / 2)) / totalMinor);
}

export function medianMinor(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return Math.floor((sorted[middle - 1] + sorted[middle] + 1) / 2);
}

function historicalMediansByCategory(actuals: readonly HistoricalCategoryActual[]): Map<string, { medianMinor: number; cycleCount: number }> {
  const grouped = new Map<string, HistoricalCategoryActual[]>();
  for (const actual of actuals.filter((item) => item.amountMinor >= 0)) {
    grouped.set(actual.categoryId, [...(grouped.get(actual.categoryId) ?? []), actual]);
  }

  return new Map(
    [...grouped.entries()].map(([categoryId, categoryActuals]) => [
      categoryId,
      {
        medianMinor: medianMinor(categoryActuals.map((actual) => actual.amountMinor)),
        cycleCount: new Set(categoryActuals.map((actual) => actual.cycleId)).size
      }
    ])
  );
}

function validateInput(input: BudgetCoachInput): void {
  if (!Number.isInteger(input.salaryMinor) || input.salaryMinor <= 0) {
    throw new Error("Main salary must be greater than RM0.00");
  }

  for (const commitment of input.commitments) {
    if (!Number.isInteger(commitment.amountMinor) || commitment.amountMinor < 0) {
      throw new Error(`${commitment.label} commitment must be zero or greater`);
    }
  }

  for (const preference of input.essentialPreferences) {
    if (!Number.isInteger(preference.minimumMinor) || preference.minimumMinor < 0) {
      throw new Error(`${preference.categoryId} minimum must be zero or greater`);
    }
    if (!Number.isInteger(preference.comfortableMinor) || preference.comfortableMinor < preference.minimumMinor) {
      throw new Error(`${preference.categoryId} comfortable amount must be greater than or equal to minimum`);
    }
  }

  for (const value of [
    input.configuredMinimumProtectedRateBasisPoints,
    input.bufferMinimumMinor,
    input.bufferEssentialRateBasisPoints
  ]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("Budget Coach rates and buffer values must be zero or greater");
    }
  }
}

function uniqueCommitments(commitments: readonly BudgetCoachCommitment[]): BudgetCoachCommitment[] {
  const seen = new Set<string>();
  const result: BudgetCoachCommitment[] = [];
  for (const commitment of commitments) {
    if (seen.has(commitment.id)) {
      continue;
    }
    seen.add(commitment.id);
    result.push(commitment);
  }
  return result;
}

function allocateWeightedCapped(
  amountMinor: number,
  items: readonly {
    id: string;
    maxMinor: number;
    weight: number;
    priority: BudgetCoachPriority;
    sortIndex: number;
  }[]
): Record<string, number> {
  const allocations: Record<string, number> = Object.fromEntries(items.map((item) => [item.id, 0]));
  let remainingMinor = Math.max(0, amountMinor);

  while (remainingMinor > 0) {
    const active = items.filter((item) => allocations[item.id] < item.maxMinor);
    if (active.length === 0) {
      break;
    }

    const totalWeight = active.reduce((total, item) => total + item.weight, 0);
    let distributedMinor = 0;

    for (const item of active) {
      const gapMinor = item.maxMinor - allocations[item.id];
      const shareMinor = Math.min(gapMinor, Math.floor((remainingMinor * item.weight) / totalWeight));
      if (shareMinor > 0) {
        allocations[item.id] += shareMinor;
        distributedMinor += shareMinor;
      }
    }

    remainingMinor -= distributedMinor;

    if (remainingMinor <= 0) {
      break;
    }

    const remainderOrder = [...active].sort(prioritySort);
    let remainderDistributed = 0;
    for (const item of remainderOrder) {
      if (remainingMinor <= 0) {
        break;
      }
      if (allocations[item.id] >= item.maxMinor) {
        continue;
      }
      allocations[item.id] += 1;
      remainingMinor -= 1;
      remainderDistributed += 1;
    }

    if (distributedMinor === 0 && remainderDistributed === 0) {
      break;
    }
  }

  return allocations;
}

function prioritySort(
  left: { priority: BudgetCoachPriority; sortIndex: number; id: string },
  right: { priority: BudgetCoachPriority; sortIndex: number; id: string }
): number {
  const weightDelta = PRIORITY_WEIGHTS[right.priority] - PRIORITY_WEIGHTS[left.priority];
  if (weightDelta !== 0) {
    return weightDelta;
  }

  const indexDelta = left.sortIndex - right.sortIndex;
  return indexDelta !== 0 ? indexDelta : left.id.localeCompare(right.id);
}

function confidenceFromHistory(history: readonly HistoricalCategoryActual[]): RecommendationConfidence {
  return confidenceFromCount(new Set(history.map((actual) => actual.cycleId)).size);
}

function confidenceFromCount(count: number): RecommendationConfidence {
  if (count >= 3) {
    return "reliable";
  }

  if (count >= 1) {
    return "observed";
  }

  return "estimated";
}

function roundToNearestMinor(amountMinor: number, incrementMinor: number): number {
  return Math.floor((amountMinor + Math.floor(incrementMinor / 2)) / incrementMinor) * incrementMinor;
}

function priorityLabel(priority: BudgetCoachPriority): string {
  return priority.slice(0, 1).toUpperCase() + priority.slice(1);
}

function isBudgetCoachProfileId(value: unknown): value is BudgetCoachProfileId {
  return value === "flexible" || value === "balanced" || value === "secure";
}

function isPriority(value: unknown): value is BudgetCoachPriority {
  return value === "low" || value === "normal" || value === "high";
}

function integerOrZero(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}
