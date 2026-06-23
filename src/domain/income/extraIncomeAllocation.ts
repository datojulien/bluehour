import { createRecordMeta, touchRecord } from "../records";
import type { BluehourSnapshot, BudgetCycle, ExtraIncomeAllocation, Transaction } from "../types";
import { isActive } from "../types";

export type ExtraIncomeAllocationChoice = "available" | "protected" | "manual" | "defer";

export interface ExtraIncomeAllocationDraft {
  incomeTransactionId: string;
  budgetCycleId?: string;
  incomeAmountMinor: number;
  availableMinor: number;
  protectedMinor: number;
  protectedAccountId?: string;
  status?: ExtraIncomeAllocation["status"];
}

export function shouldPromptForExtraIncome(transaction: Transaction, snapshot: BluehourSnapshot): boolean {
  if (transaction.type !== "income" || !isActive(transaction)) {
    return false;
  }

  if (snapshot.budgetCycles.some((cycle) => isActive(cycle) && cycle.salaryTransactionId === transaction.id)) {
    return false;
  }

  const linkedPlan = snapshot.planInstances.find((plan) => isActive(plan) && plan.linkedTransactionId === transaction.id);
  return !linkedPlan?.isMainSalaryEstimate;
}

export function activeCycleForIncome(transaction: Transaction, cycles: readonly BudgetCycle[]): BudgetCycle | undefined {
  return cycles
    .filter((cycle) => isActive(cycle) && cycle.status === "open" && transaction.occurredOn >= cycle.startedOn)
    .sort((left, right) => right.startedOn.localeCompare(left.startedOn))[0];
}

export function createExtraIncomeAllocation(draft: ExtraIncomeAllocationDraft): ExtraIncomeAllocation {
  validateAllocationAmounts(draft.incomeAmountMinor, draft.availableMinor, draft.protectedMinor);
  return {
    ...createRecordMeta("extra-income"),
    incomeTransactionId: draft.incomeTransactionId,
    budgetCycleId: draft.budgetCycleId,
    incomeAmountMinor: draft.incomeAmountMinor,
    availableMinor: draft.availableMinor,
    protectedMinor: draft.protectedMinor,
    protectedAccountId: draft.protectedAccountId,
    status: draft.status ?? statusForAmounts(draft.availableMinor, draft.protectedMinor)
  };
}

export function updateExtraIncomeAllocation(allocation: ExtraIncomeAllocation, draft: ExtraIncomeAllocationDraft): ExtraIncomeAllocation {
  if (allocation.status === "completed") {
    throw new Error("Completed extra-income allocations cannot be edited.");
  }
  validateAllocationAmounts(draft.incomeAmountMinor, draft.availableMinor, draft.protectedMinor);
  return {
    ...touchRecord(allocation),
    budgetCycleId: draft.budgetCycleId,
    incomeAmountMinor: draft.incomeAmountMinor,
    availableMinor: draft.availableMinor,
    protectedMinor: draft.protectedMinor,
    protectedAccountId: draft.protectedAccountId,
    status: draft.status ?? statusForAmounts(draft.availableMinor, draft.protectedMinor)
  };
}

export function pendingProtectedExtraIncomeMinor(snapshot: { extraIncomeAllocations: readonly ExtraIncomeAllocation[] }, cycle: BudgetCycle): number {
  return snapshot.extraIncomeAllocations
    .filter(
      (allocation) =>
        isActive(allocation) &&
        allocation.status === "pending_transfer" &&
        allocation.protectedMinor > 0 &&
        (!allocation.budgetCycleId || allocation.budgetCycleId === cycle.id)
    )
    .reduce((total, allocation) => total + allocation.protectedMinor, 0);
}

export function linkProtectedExtraIncomeTransfer(
  allocation: ExtraIncomeAllocation,
  transferTransactionId: string
): ExtraIncomeAllocation {
  if (allocation.protectedMinor <= 0) {
    throw new Error("Only protected extra-income allocations can be linked to a transfer.");
  }
  return {
    ...touchRecord(allocation),
    status: "completed",
    linkedTransferTransactionId: transferTransactionId
  };
}

function statusForAmounts(availableMinor: number, protectedMinor: number): ExtraIncomeAllocation["status"] {
  if (protectedMinor <= 0) {
    return "available_only";
  }
  if (availableMinor === 0 || protectedMinor > 0) {
    return "pending_transfer";
  }
  return "available_only";
}

function validateAllocationAmounts(incomeAmountMinor: number, availableMinor: number, protectedMinor: number): void {
  if (incomeAmountMinor <= 0) {
    throw new Error("Extra income amount must be greater than RM0.00.");
  }
  if (availableMinor < 0 || protectedMinor < 0) {
    throw new Error("Extra income allocation amounts cannot be negative.");
  }
  if (availableMinor + protectedMinor !== incomeAmountMinor) {
    throw new Error("Available and protected amounts must equal the income amount.");
  }
}
