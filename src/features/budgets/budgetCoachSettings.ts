import { addDays, isWithinInclusive } from "../../domain/dates";
import { createRecordMeta, touchRecord } from "../../domain/records";
import type { AppSettings, BluehourSnapshot, BudgetAllocation, BudgetCycle, Category, IsoDate, PlanInstance } from "../../domain/types";
import { isActive } from "../../domain/types";
import {
  buildCommitmentsForCycle,
  buildHistoricalCategoryActuals,
  defaultBudgetCoachPreferences,
  mergeBudgetCoachPreferences,
  recommendBudget,
  type BudgetCoachInput,
  type BudgetCoachPreferences,
  type BudgetCoachResult,
  type BudgetCoachScenarioIncome
} from "../../domain/budgets/budgetCoach";

export interface PreferenceSettings {
  minimumProtectedRateBasisPoints: number;
  bufferMinimumMinor: number;
  bufferEssentialRateBasisPoints: number;
  budgetCoach?: Partial<BudgetCoachPreferences>;
  [key: string]: unknown;
}

const preferenceDefaults: PreferenceSettings = {
  currency: "MYR",
  locale: "en-MY",
  dateDisplay: "DD/MM/YYYY",
  amountDisplay: "RM1,234.50",
  salaryWindowStartDay: 24,
  salaryWindowEndDay: 26,
  minimumProtectedRateBasisPoints: 1_000,
  bufferMinimumMinor: 50_000,
  bufferEssentialRateBasisPoints: 1_000,
  weeklyReconciliationDefault: true
};

export function readPreferenceSettings(settings: readonly AppSettings[]): PreferenceSettings {
  const setting = settings.find((item) => item.key === "preferences");
  if (!setting) {
    return preferenceDefaults;
  }

  try {
    return { ...preferenceDefaults, ...(JSON.parse(setting.valueJson) as Partial<PreferenceSettings>) };
  } catch {
    return preferenceDefaults;
  }
}

export function readBudgetCoachPreferences(settings: readonly AppSettings[], categories: readonly Category[]): BudgetCoachPreferences {
  const preferences = readPreferenceSettings(settings);
  return mergeBudgetCoachPreferences(categories, preferences.budgetCoach);
}

export function budgetCoachPreferenceRecord(
  settings: readonly AppSettings[],
  categories: readonly Category[],
  nextBudgetCoach: BudgetCoachPreferences
): AppSettings {
  const existing = settings.find((item) => item.key === "preferences");
  const current = readPreferenceSettings(settings);
  const normalized = mergeBudgetCoachPreferences(categories, nextBudgetCoach);
  const valueJson = JSON.stringify({
    ...current,
    budgetCoach: normalized
  });

  return existing
    ? {
        ...touchRecord(existing),
        valueJson
      }
    : {
        ...createRecordMeta("settings"),
        key: "preferences",
        valueJson
      };
}

export function buildBudgetCoachInputForCycle({
  snapshot,
  cycle,
  asOfDate: _asOfDate,
  preferences,
  salaryMinor
}: {
  snapshot: BluehourSnapshot;
  cycle: BudgetCycle;
  asOfDate: IsoDate;
  preferences: BudgetCoachPreferences;
  salaryMinor?: number;
}): BudgetCoachInput {
  const preferenceSettings = readPreferenceSettings(snapshot.settings);
  const endDate = cycle.endedOn ?? addDays(cycle.expectedNextSalaryTo, -1);

  return {
    salaryMinor: salaryMinor ?? cycle.actualMainSalaryMinor,
    cycleStartDate: cycle.startedOn,
    cycleEndDate: endDate,
    profileId: preferences.profileId,
    configuredMinimumProtectedRateBasisPoints: preferenceSettings.minimumProtectedRateBasisPoints,
    bufferMinimumMinor: preferenceSettings.bufferMinimumMinor,
    bufferEssentialRateBasisPoints: preferenceSettings.bufferEssentialRateBasisPoints,
    commitments: buildCommitmentsForCycle({
      categories: snapshot.categories,
      planInstances: snapshot.planInstances,
      subscriptions: snapshot.subscriptions,
      recurringRules: snapshot.recurringRules,
      startDate: cycle.startedOn,
      endDate
    }),
    essentialPreferences: preferences.essentialPreferences,
    discretionaryPreferences: preferences.discretionaryPreferences,
    currentAllocations: snapshot.budgetAllocations.filter((allocation) => isActive(allocation) && allocation.budgetCycleId === cycle.id),
    historicalCategoryActuals: buildHistoricalCategoryActuals({
      cycles: snapshot.budgetCycles,
      transactions: snapshot.transactions,
      transactionSplits: snapshot.transactionSplits,
      categories: snapshot.categories
    }),
    scenarioIncome: scenarioIncome(snapshot.planInstances, cycle.startedOn, endDate)
  };
}

export function onboardingBudgetCoachInput(
  snapshot: BluehourSnapshot,
  asOfDate: IsoDate,
  preferences: BudgetCoachPreferences
): BudgetCoachInput | null {
  const salaryPlan = mainSalaryEstimate(snapshot.planInstances);
  if (!salaryPlan) {
    return null;
  }

  const preferenceSettings = readPreferenceSettings(snapshot.settings);
  const endDate = addDays(salaryPlan.expectedDate, 30);

  return {
    salaryMinor: salaryPlan.expectedAmountMinor,
    cycleStartDate: salaryPlan.expectedDate,
    cycleEndDate: endDate,
    profileId: preferences.profileId,
    configuredMinimumProtectedRateBasisPoints: preferenceSettings.minimumProtectedRateBasisPoints,
    bufferMinimumMinor: preferenceSettings.bufferMinimumMinor,
    bufferEssentialRateBasisPoints: preferenceSettings.bufferEssentialRateBasisPoints,
    commitments: buildCommitmentsForCycle({
      categories: snapshot.categories,
      planInstances: snapshot.planInstances,
      subscriptions: snapshot.subscriptions,
      recurringRules: snapshot.recurringRules,
      startDate: asOfDate,
      endDate
    }),
    essentialPreferences: preferences.essentialPreferences,
    discretionaryPreferences: preferences.discretionaryPreferences,
    historicalCategoryActuals: [],
    scenarioIncome: scenarioIncome(snapshot.planInstances, asOfDate, endDate)
  };
}

export function recommendedProfileForOnboarding(
  snapshot: BluehourSnapshot,
  asOfDate: IsoDate,
  preferences: BudgetCoachPreferences
): BudgetCoachPreferences {
  const base = defaultBudgetCoachPreferences(snapshot.categories);
  const merged = mergeBudgetCoachPreferences(snapshot.categories, preferences);
  const balanced = onboardingBudgetCoachInput(snapshot, asOfDate, { ...merged, profileId: "balanced" });
  if (!balanced) {
    return merged;
  }

  if (recommendBudget(balanced).feasible) {
    return { ...merged, profileId: "balanced" };
  }

  const flexible = onboardingBudgetCoachInput(snapshot, asOfDate, { ...merged, profileId: "flexible" });
  if (flexible && recommendBudget(flexible).feasible) {
    return { ...merged, profileId: "flexible" };
  }

  return { ...base, ...merged, profileId: "flexible" };
}

export function allocationRecordsFromRecommendation({
  cycleId,
  categories,
  existingAllocations,
  recommendations,
  note
}: {
  cycleId: string;
  categories: readonly Category[];
  existingAllocations: readonly BudgetAllocation[];
  recommendations: readonly { categoryId: string; suggestedAmountMinor: number }[];
  note: string;
}): BudgetAllocation[] {
  const existingByCategory = new Map(
    existingAllocations.filter((allocation) => isActive(allocation) && allocation.budgetCycleId === cycleId).map((allocation) => [allocation.categoryId, allocation])
  );
  const allocatableCategoryIds = new Set(
    categories
      .filter((category) => isActive(category) && category.active && category.reservationMode === "envelope")
      .map((category) => category.id)
  );

  return recommendations
    .filter((recommendation) => allocatableCategoryIds.has(recommendation.categoryId))
    .map((recommendation) => {
      const existing = existingByCategory.get(recommendation.categoryId);
      return existing
        ? {
            ...touchRecord(existing),
            baseAmountMinor: recommendation.suggestedAmountMinor,
            note
          }
        : {
            ...createRecordMeta("alloc"),
            budgetCycleId: cycleId,
            categoryId: recommendation.categoryId,
            baseAmountMinor: recommendation.suggestedAmountMinor,
            note
          };
    });
}

export function appendBudgetCoachDecision({
  preferences,
  result,
  appliedCategoryIds,
  cycleId
}: {
  preferences: BudgetCoachPreferences;
  result: BudgetCoachResult;
  appliedCategoryIds: readonly string[];
  cycleId?: string;
}): BudgetCoachPreferences {
  return {
    ...preferences,
    acceptedDecisions: [
      {
        id: `coach-decision-${Date.now()}`,
        acceptedAt: new Date().toISOString(),
        cycleId,
        profileId: result.profileId,
        confidence: result.confidence,
        appliedCategoryIds: [...appliedCategoryIds]
      },
      ...(preferences.acceptedDecisions ?? [])
    ].slice(0, 12)
  };
}

function mainSalaryEstimate(plans: readonly PlanInstance[]): PlanInstance | undefined {
  return plans
    .filter((plan) => isActive(plan) && plan.kind === "income" && plan.status === "scheduled" && plan.isMainSalaryEstimate)
    .sort((left, right) => left.expectedDate.localeCompare(right.expectedDate))[0];
}

function scenarioIncome(plans: readonly PlanInstance[], startDate: IsoDate, endDate: IsoDate): BudgetCoachScenarioIncome[] {
  return plans
    .filter(
      (plan) =>
        isActive(plan) &&
        plan.kind === "income" &&
        plan.status === "scheduled" &&
        !plan.isMainSalaryEstimate &&
        isWithinInclusive(plan.expectedDate, startDate, endDate)
    )
    .map((plan) => ({
      id: plan.id,
      label: plan.name,
      amountMinor: plan.expectedAmountMinor,
      confidence: plan.confidence === "confirmed" ? "confirmed" : "possible"
    }));
}
