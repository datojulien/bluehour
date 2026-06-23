import { buildBudgetProgressRows } from "../budgets/budgetProgress";
import { addDays } from "../dates";
import { calculateSafeToSpend } from "../forecasting/safeToSpend";
import { createRecordMeta } from "../records";
import type { BluehourSnapshot, BudgetCycle, IsoDate, PurchaseCheck } from "../types";

export interface PurchaseCheckInput {
  label: string;
  amountMinor: number;
  categoryId: string;
  intendedDate: IsoDate;
}

export interface PurchaseCheckResult {
  result: PurchaseCheck["result"];
  safeToSpendBeforeMinor: number;
  safeToSpendAfterMinor: number;
  categoryRemainingBeforeMinor: number;
  categoryRemainingAfterMinor: number;
  dailyAmountAfterMinor: number;
  explanations: string[];
}

export function evaluatePurchaseCheck(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  input: PurchaseCheckInput
): PurchaseCheckResult {
  if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor)) {
    throw new Error("Purchase check amount must be a positive integer sen value.");
  }
  if (!input.label.trim()) {
    throw new Error("Purchase label is required.");
  }

  const horizonEndDate = addDays(cycle.expectedNextSalaryTo, -1);
  const safeToSpend = calculateSafeToSpend({
    asOfDate,
    horizonEndDate,
    cycle,
    accounts: snapshot.accounts,
    balanceSnapshots: snapshot.balanceSnapshots,
    transactions: snapshot.transactions,
    transactionLegs: snapshot.transactionLegs,
    transactionSplits: snapshot.transactionSplits,
    categories: snapshot.categories,
    budgetAllocations: snapshot.budgetAllocations,
    budgetTransfers: snapshot.budgetTransfers,
    planInstances: snapshot.planInstances,
    extraIncomeAllocations: snapshot.extraIncomeAllocations,
    savingsGoalContributions: snapshot.savingsGoalContributions,
    includeFutureIncome: false
  });
  const categoryRow = buildBudgetProgressRows({ snapshot, cycle, asOfDate }).find((row) => row.categoryId === input.categoryId);
  const categoryRemainingBeforeMinor = categoryRow?.remainingAfterFuturePlansMinor ?? 0;
  const categoryRemainingAfterMinor = categoryRemainingBeforeMinor - input.amountMinor;
  const safeToSpendAfterMinor = safeToSpend.safeToSpendMinor - input.amountMinor;
  const dailyAmountAfterMinor = Math.max(0, Math.floor(Math.max(0, safeToSpendAfterMinor) / safeToSpend.remainingDays));
  const explanations: string[] = [];

  if (safeToSpendAfterMinor < 0) {
    explanations.push("The purchase would exceed the current safe-to-spend amount before the next salary window.");
  }
  if (categoryRow && categoryRemainingAfterMinor < 0) {
    explanations.push("The category would be over its allocation after reserved future plans.");
  }
  if (safeToSpend.safeToSpendMinor > 0 && input.amountMinor > roundDivide(safeToSpend.safeToSpendMinor, 2)) {
    explanations.push("The purchase uses more than half of the current safe-to-spend amount.");
  } else if (safeToSpend.safeToSpendMinor > 0 && input.amountMinor > roundDivide(safeToSpend.safeToSpendMinor, 4)) {
    explanations.push("The purchase uses a meaningful share of the current safe-to-spend amount.");
  }
  if (categoryRow && categoryRow.allocationMinor > 0 && input.amountMinor > roundDivide(categoryRow.allocationMinor, 3)) {
    explanations.push("The purchase is large relative to this category's salary-cycle allocation.");
  }
  if (explanations.length === 0) {
    explanations.push("The purchase fits the current safe-to-spend and category allocation checks.");
  }

  const result: PurchaseCheck["result"] =
    safeToSpendAfterMinor < 0 || categoryRemainingAfterMinor < 0
      ? "not_recommended"
      : explanations.length > 1 || input.amountMinor > roundDivide(safeToSpend.safeToSpendMinor, 4)
        ? "caution"
        : "safe";

  return {
    result,
    safeToSpendBeforeMinor: safeToSpend.safeToSpendMinor,
    safeToSpendAfterMinor,
    categoryRemainingBeforeMinor,
    categoryRemainingAfterMinor,
    dailyAmountAfterMinor,
    explanations
  };
}

export function purchaseCheckRecord(
  input: PurchaseCheckInput,
  result: PurchaseCheckResult,
  decision: PurchaseCheck["decision"] = "dismissed",
  links: Pick<PurchaseCheck, "linkedTransactionId" | "linkedPlanInstanceId"> = {}
): PurchaseCheck {
  return {
    ...createRecordMeta("purchase-check"),
    checkedOn: input.intendedDate,
    label: input.label.trim(),
    categoryId: input.categoryId,
    amountMinor: input.amountMinor,
    result: result.result,
    safeToSpendBeforeMinor: result.safeToSpendBeforeMinor,
    safeToSpendAfterMinor: result.safeToSpendAfterMinor,
    decision,
    linkedTransactionId: links.linkedTransactionId,
    linkedPlanInstanceId: links.linkedPlanInstanceId
  };
}

function roundDivide(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}
