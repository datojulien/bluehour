import { z } from "zod";
import type {
  Account,
  BluehourSnapshot,
  CategoryGroup,
  CategoryNature,
  IsoDate,
  ReservationMode
} from "../types";
import { isActive } from "../types";
import type { BudgetCoachInput, BudgetCoachPriority } from "../budgets/budgetCoach";
import { redactSensitiveFreeText } from "./geminiCycleReport";

export interface GeminiBudgetSetupCategory {
  id: string;
  name: string;
  group: CategoryGroup;
  nature: CategoryNature;
  reservationMode: ReservationMode;
  active: boolean;
}

export interface GeminiBudgetSetupPayload {
  version: 1;
  currency: "MYR";
  generatedOn: IsoDate;
  privacy: {
    freeTextRedacted: true;
    accountNumbersExcluded: true;
    apiKeyStoredByBluehour: false;
  };
  setup: {
    salaryMinor: number;
    firstCycleStartDate?: IsoDate;
    firstCycleEndDate?: IsoDate;
    configuredMinimumProtectedRateBasisPoints: number;
    bufferMinimumMinor: number;
    bufferEssentialRateBasisPoints: number;
  };
  accounts: Array<{
    id: string;
    label: string;
    type: Account["type"];
    role: Account["role"];
    trackingMode: Account["trackingMode"];
  }>;
  categories: GeminiBudgetSetupCategory[];
  knownCommitments: Array<{
    id: string;
    label: string;
    amountMinor: number;
    categoryId?: string;
    categoryName?: string;
    dueDate?: IsoDate;
    optional?: boolean;
    source: string;
  }>;
  plannedItems: Array<{
    id: string;
    kind: string;
    name: string;
    expectedDate: IsoDate;
    expectedAmountMinor: number;
    confidence: string;
    reservation: string;
    status: string;
    categoryId?: string;
    categoryName?: string;
    essential?: boolean;
    isMainSalaryEstimate?: boolean;
  }>;
  essentialPreferences: Array<{
    categoryId: string;
    categoryName: string;
    minimumMinor: number;
    comfortableMinor: number;
    priority: BudgetCoachPriority;
  }>;
  discretionaryPreferences: Array<{
    categoryId: string;
    categoryName: string;
    enabled: boolean;
    priority: BudgetCoachPriority;
  }>;
}

export interface GeminiBudgetSetupReport {
  reportTitle: string;
  executiveSummary: string;
  firstCycleBudget: GeminiFirstCycleBudgetItem[];
  riskFlags: string[];
  actionPlan: string[];
  disclaimer: string;
}

export interface GeminiFirstCycleBudgetItem {
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  priority: "essential" | "flex" | "reduce";
  confidence: "low" | "medium" | "high";
  rationale: string;
  warnings: string[];
}

export const GEMINI_BUDGET_SETUP_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reportTitle: { type: "string" },
    executiveSummary: { type: "string" },
    firstCycleBudget: {
      type: "array",
      items: {
        type: "object",
        properties: {
          categoryId: { type: "string" },
          categoryName: { type: "string" },
          amountMinor: { type: "integer" },
          priority: { type: "string", enum: ["essential", "flex", "reduce"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          rationale: { type: "string" },
          warnings: { type: "array", items: { type: "string" } }
        },
        required: ["categoryId", "categoryName", "amountMinor", "priority", "confidence", "rationale", "warnings"]
      }
    },
    riskFlags: { type: "array", items: { type: "string" } },
    actionPlan: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" }
  },
  required: ["reportTitle", "executiveSummary", "firstCycleBudget", "riskFlags", "actionPlan", "disclaimer"]
} as const;

const reportSchema = z.object({
  reportTitle: z.string().min(1).max(160),
  executiveSummary: z.string().min(1).max(4_000),
  firstCycleBudget: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        categoryName: z.string().min(1).max(140),
        amountMinor: z.number().int().nonnegative(),
        priority: z.enum(["essential", "flex", "reduce"]),
        confidence: z.enum(["low", "medium", "high"]),
        rationale: z.string().min(1).max(1_200),
        warnings: z.array(z.string().min(1).max(500)).max(8).default([])
      })
    )
    .max(80),
  riskFlags: z.array(z.string().min(1).max(1_000)).max(16),
  actionPlan: z.array(z.string().min(1).max(1_000)).max(16),
  disclaimer: z.string().min(1).max(1_000)
});

export function buildGeminiBudgetSetupPayload(
  snapshot: BluehourSnapshot,
  input: BudgetCoachInput,
  asOfDate: IsoDate
): GeminiBudgetSetupPayload {
  const categoryById = new Map(snapshot.categories.map((category) => [category.id, category]));

  return {
    version: 1,
    currency: "MYR",
    generatedOn: asOfDate,
    privacy: {
      freeTextRedacted: true,
      accountNumbersExcluded: true,
      apiKeyStoredByBluehour: false
    },
    setup: {
      salaryMinor: input.salaryMinor,
      firstCycleStartDate: input.cycleStartDate,
      firstCycleEndDate: input.cycleEndDate,
      configuredMinimumProtectedRateBasisPoints: input.configuredMinimumProtectedRateBasisPoints,
      bufferMinimumMinor: input.bufferMinimumMinor,
      bufferEssentialRateBasisPoints: input.bufferEssentialRateBasisPoints
    },
    accounts: snapshot.accounts
      .filter(isActive)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
      .map((account) => ({
        id: account.id,
        label: redactSensitiveFreeText(account.name),
        type: account.type,
        role: account.role,
        trackingMode: account.trackingMode
      })),
    categories: snapshot.categories
      .filter(isActive)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
      .map((category) => ({
        id: category.id,
        name: redactSensitiveFreeText(category.name),
        group: category.group,
        nature: category.nature,
        reservationMode: category.reservationMode,
        active: category.active
      })),
    knownCommitments: input.commitments.map((commitment) => ({
      id: commitment.id,
      label: redactSensitiveFreeText(commitment.label),
      amountMinor: commitment.amountMinor,
      categoryId: commitment.categoryId,
      categoryName: commitment.categoryId ? redactSensitiveFreeText(categoryById.get(commitment.categoryId)?.name ?? commitment.categoryId) : undefined,
      dueDate: commitment.dueDate,
      optional: commitment.optional,
      source: commitment.source
    })),
    plannedItems: snapshot.planInstances
      .filter(isActive)
      .sort((left, right) => left.expectedDate.localeCompare(right.expectedDate) || left.name.localeCompare(right.name))
      .map((plan) => ({
        id: plan.id,
        kind: plan.kind,
        name: redactSensitiveFreeText(plan.name),
        expectedDate: plan.expectedDate,
        expectedAmountMinor: plan.expectedAmountMinor,
        confidence: plan.confidence,
        reservation: plan.reservation,
        status: plan.status,
        categoryId: plan.categoryId,
        categoryName: plan.categoryId ? redactSensitiveFreeText(categoryById.get(plan.categoryId)?.name ?? plan.categoryId) : undefined,
        essential: plan.essential,
        isMainSalaryEstimate: plan.isMainSalaryEstimate
      })),
    essentialPreferences: input.essentialPreferences.map((preference) => ({
      categoryId: preference.categoryId,
      categoryName: redactSensitiveFreeText(categoryById.get(preference.categoryId)?.name ?? preference.categoryId),
      minimumMinor: preference.minimumMinor,
      comfortableMinor: preference.comfortableMinor,
      priority: preference.priority
    })),
    discretionaryPreferences: input.discretionaryPreferences.map((preference) => ({
      categoryId: preference.categoryId,
      categoryName: redactSensitiveFreeText(categoryById.get(preference.categoryId)?.name ?? preference.categoryId),
      enabled: preference.enabled,
      priority: preference.priority
    }))
  };
}

export function buildGeminiBudgetSetupPrompt(payload: GeminiBudgetSetupPayload): string {
  return `You are Bluehour's opt-in Gemini first salary-cycle budget setup assistant.

Boundaries:
- Provide educational budgeting guidance only.
- Do not provide investment, tax, legal, credit, insurance, or regulated financial advice.
- Do not say that any budget, transfer, categorisation rule, reconciliation adjustment, buffer change, subscription change, goal, purchase, or bank transaction has been applied. The user must approve any change in Bluehour.
- Use only the provided setup data. If evidence is missing, say what is missing.
- Monetary fields in the JSON response must be integer sen, not ringgit floats.
- Use category IDs exactly as provided.
- The firstCycleBudget should include only active envelope categories. Known commitments are already planned separately, so do not create plan-category allocations unless an active envelope category exists for the spending.
- Keep the first cycle realistic: preserve essentials, the configured protected target, and the safety buffer before discretionary spending.

Return only JSON that matches the response schema.

Bluehour setup payload:
${JSON.stringify(payload)}`;
}

export function normalizeGeminiBudgetSetupReport(
  value: unknown,
  categories: readonly GeminiBudgetSetupCategory[]
): GeminiBudgetSetupReport {
  const parsed = reportSchema.parse(value);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const envelopeCategoryIds = new Set(
    categories
      .filter((category) => category.active && category.reservationMode === "envelope" && category.nature !== "administrative" && category.nature !== "protected")
      .map((category) => category.id)
  );
  const seenCategoryIds = new Set<string>();
  const skippedCategoryIds: string[] = [];

  const firstCycleBudget = parsed.firstCycleBudget.flatMap((item) => {
    const category = categoryById.get(item.categoryId);
    if (!category || !envelopeCategoryIds.has(item.categoryId) || seenCategoryIds.has(item.categoryId)) {
      skippedCategoryIds.push(item.categoryId);
      return [];
    }
    seenCategoryIds.add(item.categoryId);
    return [
      {
        ...item,
        categoryName: redactSensitiveFreeText(category.name),
        rationale: redactSensitiveFreeText(item.rationale),
        warnings: item.warnings.map(redactSensitiveFreeText)
      }
    ];
  });

  const skippedFlag =
    skippedCategoryIds.length > 0
      ? [`Gemini returned ${skippedCategoryIds.length} first-cycle budget item${skippedCategoryIds.length === 1 ? "" : "s"} for an unknown, duplicate, protected, administrative, plan, or non-budget category; Bluehour ignored those items for application.`]
      : [];

  return {
    reportTitle: redactSensitiveFreeText(parsed.reportTitle),
    executiveSummary: redactSensitiveFreeText(parsed.executiveSummary),
    firstCycleBudget,
    riskFlags: [...skippedFlag, ...parsed.riskFlags.map(redactSensitiveFreeText)],
    actionPlan: parsed.actionPlan.map(redactSensitiveFreeText),
    disclaimer: redactSensitiveFreeText(parsed.disclaimer)
  };
}
