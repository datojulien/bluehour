import { z } from "zod";
import { addDays, isWithinInclusive } from "../dates";
import { sumMinor } from "../money";
import { buildBudgetProgressRows } from "../budgets/budgetProgress";
import type {
  Account,
  BluehourSnapshot,
  BudgetCycle,
  CategoryGroup,
  CategoryNature,
  IsoDate,
  ReservationMode,
  TransactionSplit
} from "../types";
import { isActive } from "../types";

export interface GeminiCycleReportCategory {
  id: string;
  name: string;
  group: CategoryGroup;
  nature: CategoryNature;
  reservationMode: ReservationMode;
  active: boolean;
}

export interface GeminiCycleReportPayload {
  version: 1;
  currency: "MYR";
  generatedOn: IsoDate;
  privacy: {
    freeTextRedacted: true;
    accountNumbersExcluded: true;
    apiKeyStoredByBluehour: false;
  };
  cycle: {
    id: string;
    startedOn: IsoDate;
    endedOn: IsoDate;
    reviewAsOfDate: IsoDate;
    expectedNextSalaryFrom: IsoDate;
    expectedNextSalaryTo: IsoDate;
    actualMainSalaryMinor: number;
    protectedRateBasisPoints: number;
    bufferMinimumMinor: number;
    bufferEssentialRateBasisPoints: number;
    additionalProtectedCommitmentMinor: number;
  };
  followingCycle: {
    expectedSalaryWindowFrom: IsoDate;
    expectedSalaryWindowTo: IsoDate;
    planningInstruction: string;
  };
  accounts: Array<{
    id: string;
    label: string;
    type: Account["type"];
    role: Account["role"];
    trackingMode: Account["trackingMode"];
  }>;
  categories: GeminiCycleReportCategory[];
  budgetAllocations: Array<{
    categoryId: string;
    categoryName: string;
    baseAmountMinor: number;
  }>;
  budgetTransfers: Array<{
    fromCategoryId: string;
    fromCategoryName: string;
    toCategoryId: string;
    toCategoryName: string;
    amountMinor: number;
    occurredOn: IsoDate;
    note?: string;
  }>;
  budgetProgress: Array<{
    categoryId: string;
    categoryName: string;
    allocationMinor: number;
    spentMinor: number;
    reservedFuturePlansMinor: number;
    remainingAfterFuturePlansMinor: number;
    percentageUsedOrReserved: number;
    state: string;
  }>;
  transactions: GeminiCycleTransactionPayload[];
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
  }>;
  subscriptions: Array<{
    id: string;
    provider: string;
    billingFrequency: string;
    nextPaymentDate: IsoDate;
    essential: boolean;
    valueRating?: string;
    status: string;
  }>;
  savingsGoals: Array<{
    id: string;
    name: string;
    targetMinor: number;
    currentMinor: number;
    deadline?: IsoDate;
    priority: string;
    status: string;
  }>;
}

export interface GeminiCycleTransactionPayload {
  id: string;
  occurredOn: IsoDate;
  type: string;
  description: string;
  merchantNormalized?: string;
  note?: string;
  source: string;
  signedAccountMovementMinor: number;
  accountMovements: Array<{
    accountId: string;
    accountLabel: string;
    accountRole: Account["role"];
    deltaMinor: number;
  }>;
  splits: Array<{
    categoryId: string;
    categoryName: string;
    direction: TransactionSplit["direction"];
    amountMinor: number;
  }>;
}

export interface GeminiCycleReport {
  reportTitle: string;
  executiveSummary: string;
  currentCycleAnalysis: string[];
  savingAdvice: GeminiSavingAdvice[];
  spendPriorities: GeminiSpendPriority[];
  reductions: GeminiReductionAdvice[];
  nextCycleBudget: GeminiNextCycleBudgetItem[];
  riskFlags: string[];
  actionPlan: string[];
  disclaimer: string;
}

export interface GeminiSavingAdvice {
  title: string;
  categoryId?: string;
  rationale: string;
  estimatedSavingMinor: number;
}

export interface GeminiSpendPriority {
  title: string;
  categoryId?: string;
  rationale: string;
  suggestedAmountMinor: number;
}

export interface GeminiReductionAdvice {
  categoryId: string;
  categoryName: string;
  currentCycleSpentMinor: number;
  recommendedNextCycleMinor: number;
  rationale: string;
}

export interface GeminiNextCycleBudgetItem {
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  priority: "protect" | "essential" | "flex" | "reduce";
  confidence: "low" | "medium" | "high";
  rationale: string;
  warnings: string[];
}

export const GEMINI_CYCLE_REPORT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reportTitle: { type: "string" },
    executiveSummary: { type: "string" },
    currentCycleAnalysis: { type: "array", items: { type: "string" } },
    savingAdvice: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          categoryId: { type: "string" },
          rationale: { type: "string" },
          estimatedSavingMinor: { type: "integer" }
        },
        required: ["title", "rationale", "estimatedSavingMinor"]
      }
    },
    spendPriorities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          categoryId: { type: "string" },
          rationale: { type: "string" },
          suggestedAmountMinor: { type: "integer" }
        },
        required: ["title", "rationale", "suggestedAmountMinor"]
      }
    },
    reductions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          categoryId: { type: "string" },
          categoryName: { type: "string" },
          currentCycleSpentMinor: { type: "integer" },
          recommendedNextCycleMinor: { type: "integer" },
          rationale: { type: "string" }
        },
        required: ["categoryId", "categoryName", "currentCycleSpentMinor", "recommendedNextCycleMinor", "rationale"]
      }
    },
    nextCycleBudget: {
      type: "array",
      items: {
        type: "object",
        properties: {
          categoryId: { type: "string" },
          categoryName: { type: "string" },
          amountMinor: { type: "integer" },
          priority: { type: "string", enum: ["protect", "essential", "flex", "reduce"] },
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
  required: [
    "reportTitle",
    "executiveSummary",
    "currentCycleAnalysis",
    "savingAdvice",
    "spendPriorities",
    "reductions",
    "nextCycleBudget",
    "riskFlags",
    "actionPlan",
    "disclaimer"
  ]
} as const;

const reportSchema = z.object({
  reportTitle: z.string().min(1).max(160),
  executiveSummary: z.string().min(1).max(4_000),
  currentCycleAnalysis: z.array(z.string().min(1).max(1_000)).max(16),
  savingAdvice: z
    .array(
      z.object({
        title: z.string().min(1).max(140),
        categoryId: z.string().min(1).optional(),
        rationale: z.string().min(1).max(1_200),
        estimatedSavingMinor: z.number().int().nonnegative()
      })
    )
    .max(16),
  spendPriorities: z
    .array(
      z.object({
        title: z.string().min(1).max(140),
        categoryId: z.string().min(1).optional(),
        rationale: z.string().min(1).max(1_200),
        suggestedAmountMinor: z.number().int().nonnegative()
      })
    )
    .max(16),
  reductions: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        categoryName: z.string().min(1).max(140),
        currentCycleSpentMinor: z.number().int().nonnegative(),
        recommendedNextCycleMinor: z.number().int().nonnegative(),
        rationale: z.string().min(1).max(1_200)
      })
    )
    .max(24),
  nextCycleBudget: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        categoryName: z.string().min(1).max(140),
        amountMinor: z.number().int().nonnegative(),
        priority: z.enum(["protect", "essential", "flex", "reduce"]),
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

export function buildGeminiCycleReportPayload(snapshot: BluehourSnapshot, cycle: BudgetCycle, asOfDate: IsoDate): GeminiCycleReportPayload {
  const cycleEndDate = cycle.endedOn ?? addDays(cycle.expectedNextSalaryTo, -1);
  const categoryById = new Map(snapshot.categories.map((category) => [category.id, category]));
  const accountById = new Map(snapshot.accounts.map((account) => [account.id, account]));
  const budgetProgress = buildBudgetProgressRows({ snapshot, cycle, asOfDate, horizonEndDate: cycleEndDate });
  const activeTransactionIds = new Set(
    snapshot.transactions
      .filter((transaction) => isActive(transaction) && isWithinInclusive(transaction.occurredOn, cycle.startedOn, cycleEndDate))
      .map((transaction) => transaction.id)
  );

  return {
    version: 1,
    currency: "MYR",
    generatedOn: asOfDate,
    privacy: {
      freeTextRedacted: true,
      accountNumbersExcluded: true,
      apiKeyStoredByBluehour: false
    },
    cycle: {
      id: cycle.id,
      startedOn: cycle.startedOn,
      endedOn: cycleEndDate,
      reviewAsOfDate: asOfDate,
      expectedNextSalaryFrom: cycle.expectedNextSalaryFrom,
      expectedNextSalaryTo: cycle.expectedNextSalaryTo,
      actualMainSalaryMinor: cycle.actualMainSalaryMinor,
      protectedRateBasisPoints: cycle.protectedRateBasisPoints,
      bufferMinimumMinor: cycle.bufferMinimumMinor,
      bufferEssentialRateBasisPoints: cycle.bufferEssentialRateBasisPoints,
      additionalProtectedCommitmentMinor: cycle.additionalProtectedCommitmentMinor ?? 0
    },
    followingCycle: {
      expectedSalaryWindowFrom: cycle.expectedNextSalaryFrom,
      expectedSalaryWindowTo: cycle.expectedNextSalaryTo,
      planningInstruction:
        "Plan the next salary cycle from the next actual salary date. Bluehour will only apply category allocations after explicit user approval during cycle close."
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
    budgetAllocations: snapshot.budgetAllocations
      .filter((allocation) => isActive(allocation) && allocation.budgetCycleId === cycle.id)
      .map((allocation) => ({
        categoryId: allocation.categoryId,
        categoryName: redactSensitiveFreeText(categoryById.get(allocation.categoryId)?.name ?? allocation.categoryId),
        baseAmountMinor: allocation.baseAmountMinor
      })),
    budgetTransfers: snapshot.budgetTransfers
      .filter((transfer) => isActive(transfer) && transfer.budgetCycleId === cycle.id)
      .map((transfer) => ({
        fromCategoryId: transfer.fromCategoryId,
        fromCategoryName: redactSensitiveFreeText(categoryById.get(transfer.fromCategoryId)?.name ?? transfer.fromCategoryId),
        toCategoryId: transfer.toCategoryId,
        toCategoryName: redactSensitiveFreeText(categoryById.get(transfer.toCategoryId)?.name ?? transfer.toCategoryId),
        amountMinor: transfer.amountMinor,
        occurredOn: transfer.occurredOn,
        note: redactOptionalFreeText(transfer.note)
      })),
    budgetProgress: budgetProgress.map((row) => ({
      categoryId: row.categoryId,
      categoryName: redactSensitiveFreeText(row.categoryName),
      allocationMinor: row.allocationMinor,
      spentMinor: row.spentMinor,
      reservedFuturePlansMinor: row.reservedFuturePlansMinor,
      remainingAfterFuturePlansMinor: row.remainingAfterFuturePlansMinor,
      percentageUsedOrReserved: row.percentageUsedOrReserved,
      state: row.state
    })),
    transactions: snapshot.transactions
      .filter((transaction) => activeTransactionIds.has(transaction.id))
      .sort((left, right) => left.occurredOn.localeCompare(right.occurredOn) || left.description.localeCompare(right.description))
      .map((transaction) => {
        const accountMovements = snapshot.transactionLegs
          .filter((leg) => isActive(leg) && leg.transactionId === transaction.id)
          .map((leg) => {
            const account = accountById.get(leg.accountId);
            return {
              accountId: leg.accountId,
              accountLabel: redactSensitiveFreeText(account?.name ?? leg.accountId),
              accountRole: account?.role ?? "spendable",
              deltaMinor: leg.deltaMinor
            };
          });
        const splits = snapshot.transactionSplits
          .filter((split) => isActive(split) && split.transactionId === transaction.id)
          .map((split) => ({
            categoryId: split.categoryId,
            categoryName: redactSensitiveFreeText(categoryById.get(split.categoryId)?.name ?? split.categoryId),
            direction: split.direction,
            amountMinor: split.amountMinor
          }));

        return {
          id: transaction.id,
          occurredOn: transaction.occurredOn,
          type: transaction.type,
          description: redactSensitiveFreeText(transaction.description),
          merchantNormalized: redactOptionalFreeText(transaction.merchantNormalized),
          note: redactOptionalFreeText(transaction.note),
          source: transaction.source,
          signedAccountMovementMinor: sumMinor(accountMovements.map((movement) => movement.deltaMinor)),
          accountMovements,
          splits
        };
      }),
    plannedItems: snapshot.planInstances
      .filter((plan) => isActive(plan) && isWithinInclusive(plan.expectedDate, cycle.startedOn, cycle.expectedNextSalaryTo))
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
        essential: plan.essential
      })),
    subscriptions: snapshot.subscriptions
      .filter(isActive)
      .sort((left, right) => left.nextPaymentDate.localeCompare(right.nextPaymentDate) || left.provider.localeCompare(right.provider))
      .map((subscription) => ({
        id: subscription.id,
        provider: redactSensitiveFreeText(subscription.provider),
        billingFrequency: subscription.billingFrequency,
        nextPaymentDate: subscription.nextPaymentDate,
        essential: subscription.essential,
        valueRating: subscription.valueRating,
        status: subscription.status ?? "active"
      })),
    savingsGoals: snapshot.savingsGoals
      .filter(isActive)
      .sort((left, right) => left.priority.localeCompare(right.priority) || left.name.localeCompare(right.name))
      .map((goal) => ({
        id: goal.id,
        name: redactSensitiveFreeText(goal.name),
        targetMinor: goal.targetMinor,
        currentMinor: goal.currentManualMinor ?? 0,
        deadline: goal.deadline,
        priority: goal.priority,
        status: goal.status
      }))
  };
}

export function buildGeminiCycleReportPrompt(payload: GeminiCycleReportPayload): string {
  return `You are Bluehour's opt-in Gemini salary-cycle review assistant.

Boundaries:
- Provide educational cash-flow and budgeting guidance only.
- Do not provide investment, tax, legal, credit, insurance, or regulated financial advice.
- Do not say that any budget, transfer, categorisation rule, reconciliation adjustment, buffer change, purchase, subscription cancellation, or savings transfer has been applied. The user must approve any change in Bluehour.
- Use only the provided data. If evidence is missing, say what is missing.
- Monetary fields in the JSON response must be integer sen, not ringgit floats.
- Use category IDs exactly as provided. Prefer active categories whose reservationMode is "plan" or "envelope" for nextCycleBudget.
- The nextCycleBudget should be realistic for the following salary cycle and should preserve known commitments, essentials, protected goals, and a buffer before discretionary spending.
- Do not quote raw transaction descriptions unless necessary. Summarise patterns instead.

Return only JSON that matches the response schema.

Bluehour payload:
${JSON.stringify(payload)}`;
}

export function normalizeGeminiCycleReport(value: unknown, categories: readonly GeminiCycleReportCategory[]): GeminiCycleReport {
  const parsed = reportSchema.parse(value);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const allocatableCategoryIds = new Set(
    categories
      .filter((category) => category.active && category.nature !== "administrative" && category.nature !== "protected" && category.reservationMode !== "none")
      .map((category) => category.id)
  );
  const seenBudgetCategoryIds = new Set<string>();
  const skippedBudgetCategoryIds: string[] = [];

  const nextCycleBudget = parsed.nextCycleBudget.flatMap((item) => {
    const category = categoryById.get(item.categoryId);
    if (!category || !allocatableCategoryIds.has(item.categoryId) || seenBudgetCategoryIds.has(item.categoryId)) {
      skippedBudgetCategoryIds.push(item.categoryId);
      return [];
    }
    seenBudgetCategoryIds.add(item.categoryId);
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
    skippedBudgetCategoryIds.length > 0
      ? [`Gemini returned ${skippedBudgetCategoryIds.length} next-cycle budget item${skippedBudgetCategoryIds.length === 1 ? "" : "s"} for an unknown, duplicate, protected, administrative, or non-budget category; Bluehour ignored those items for application.`]
      : [];

  return {
    reportTitle: redactSensitiveFreeText(parsed.reportTitle),
    executiveSummary: redactSensitiveFreeText(parsed.executiveSummary),
    currentCycleAnalysis: parsed.currentCycleAnalysis.map(redactSensitiveFreeText),
    savingAdvice: parsed.savingAdvice.map((item) => ({
      ...item,
      title: redactSensitiveFreeText(item.title),
      rationale: redactSensitiveFreeText(item.rationale)
    })),
    spendPriorities: parsed.spendPriorities.map((item) => ({
      ...item,
      title: redactSensitiveFreeText(item.title),
      rationale: redactSensitiveFreeText(item.rationale)
    })),
    reductions: parsed.reductions.map((item) => ({
      ...item,
      categoryName: redactSensitiveFreeText(categoryById.get(item.categoryId)?.name ?? item.categoryName),
      rationale: redactSensitiveFreeText(item.rationale)
    })),
    nextCycleBudget,
    riskFlags: [...skippedFlag, ...parsed.riskFlags.map(redactSensitiveFreeText)],
    actionPlan: parsed.actionPlan.map(redactSensitiveFreeText),
    disclaimer: redactSensitiveFreeText(parsed.disclaimer)
  };
}

export function redactSensitiveFreeText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:\d[ -]?){10,19}\b/g, "[redacted-number]")
    .replace(/\b\d{6,}\b/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim();
}

function redactOptionalFreeText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const redacted = redactSensitiveFreeText(value);
  return redacted.length > 0 ? redacted : undefined;
}
