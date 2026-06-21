import { addDays } from "../dates";
import { parseMoneyInput, percentageOfMinor } from "../money";
import { createRecordMeta } from "../records";
import type {
  BalanceSnapshot,
  BudgetAllocation,
  BudgetCycle,
  Category,
  IsoDate,
  Transaction,
  TransactionLeg,
  TransactionSplit
} from "../types";
import { closeCycleForActualSalary, nextSalaryWindowFromStart } from "./salaryCycle";

export interface StartFirstCycleInput {
  salaryDate: IsoDate;
  salaryDepositText: string;
  currentBalanceText: string;
  destinationAccountId: string;
  incomeCategoryId: string;
  existingCycles?: readonly BudgetCycle[];
}

export interface StartFirstCycleResult {
  openingSnapshot: BalanceSnapshot;
  salaryTransaction: Transaction;
  salaryLeg: TransactionLeg;
  salarySplit: TransactionSplit;
  cycle: BudgetCycle;
}

export function startFirstSalaryCycle(input: StartFirstCycleInput): StartFirstCycleResult {
  if (input.existingCycles?.some((cycle) => cycle.status === "open")) {
    throw new Error("An open salary cycle already exists");
  }

  const salaryDepositMinor = parseMoneyInput(input.salaryDepositText);
  const currentBalanceMinor = parseMoneyInput(input.currentBalanceText);
  if (salaryDepositMinor <= 0) {
    throw new Error("Salary deposit must be greater than RM0.00");
  }

  const preSalaryBalanceMinor = currentBalanceMinor - salaryDepositMinor;
  const salaryTransaction: Transaction = {
    ...createRecordMeta("txn"),
    type: "income",
    status: "actual",
    occurredOn: input.salaryDate,
    description: "Main salary",
    merchantNormalized: "main salary",
    source: "manual"
  };
  const salaryLeg: TransactionLeg = {
    ...createRecordMeta("leg"),
    transactionId: salaryTransaction.id,
    accountId: input.destinationAccountId,
    deltaMinor: salaryDepositMinor
  };
  const salarySplit: TransactionSplit = {
    ...createRecordMeta("split"),
    transactionId: salaryTransaction.id,
    categoryId: input.incomeCategoryId,
    direction: "income",
    amountMinor: salaryDepositMinor
  };
  const window = nextSalaryWindowFromStart(input.salaryDate, 24, 26);

  return {
    openingSnapshot: {
      ...createRecordMeta("bal"),
      accountId: input.destinationAccountId,
      asOfDate: addDays(input.salaryDate, -1),
      amountMinor: preSalaryBalanceMinor,
      source: "opening",
      note: "Derived from current balance minus salary deposit."
    },
    salaryTransaction,
    salaryLeg,
    salarySplit,
    cycle: {
      ...createRecordMeta("cycle"),
      startedOn: input.salaryDate,
      status: "open",
      salaryTransactionId: salaryTransaction.id,
      expectedNextSalaryFrom: window.expectedNextSalaryFrom,
      expectedNextSalaryTo: window.expectedNextSalaryTo,
      protectedRateBasisPoints: 1_000,
      bufferMinimumMinor: 50_000,
      bufferEssentialRateBasisPoints: 1_000,
      actualMainSalaryMinor: salaryDepositMinor
    }
  };
}

export interface CloseSalaryCycleInput {
  currentCycle: BudgetCycle;
  actualSalaryDate: IsoDate;
  salaryDepositText: string;
  destinationAccountId: string;
  incomeCategoryId: string;
  categories: readonly Category[];
  allocations: readonly BudgetAllocation[];
  reconciliationComplete?: boolean;
  skipReconciliationNote?: string;
}

export interface CloseSalaryCycleResult {
  closedCycle: BudgetCycle;
  newCycle: BudgetCycle;
  salaryTransaction: Transaction;
  salaryLeg: TransactionLeg;
  salarySplit: TransactionSplit;
  nextAllocations: BudgetAllocation[];
}

export function closeSalaryCycleWithActualSalary(input: CloseSalaryCycleInput): CloseSalaryCycleResult {
  if (input.currentCycle.status !== "open") {
    throw new Error("Only an open salary cycle can be closed");
  }

  if (!input.reconciliationComplete && !input.skipReconciliationNote?.trim()) {
    throw new Error("Cycle close requires completed reconciliation or an explicit skip note");
  }

  const salaryDepositMinor = parseMoneyInput(input.salaryDepositText);
  if (salaryDepositMinor <= 0) {
    throw new Error("Salary deposit must be greater than RM0.00");
  }

  const salaryTransaction: Transaction = {
    ...createRecordMeta("txn"),
    type: "income",
    status: "actual",
    occurredOn: input.actualSalaryDate,
    description: "Main salary",
    merchantNormalized: "main salary",
    source: "manual",
    note: input.skipReconciliationNote || undefined
  };
  const salaryLeg: TransactionLeg = {
    ...createRecordMeta("leg"),
    transactionId: salaryTransaction.id,
    accountId: input.destinationAccountId,
    deltaMinor: salaryDepositMinor
  };
  const salarySplit: TransactionSplit = {
    ...createRecordMeta("split"),
    transactionId: salaryTransaction.id,
    categoryId: input.incomeCategoryId,
    direction: "income",
    amountMinor: salaryDepositMinor
  };
  const { closedCycle, newCycle } = closeCycleForActualSalary(
    input.currentCycle,
    input.actualSalaryDate,
    salaryTransaction.id,
    salaryDepositMinor
  );

  return {
    closedCycle,
    newCycle,
    salaryTransaction,
    salaryLeg,
    salarySplit,
    nextAllocations: cloneAllocationsForNextCycle(input.currentCycle.id, newCycle.id, input.categories, input.allocations)
  };
}

function cloneAllocationsForNextCycle(
  oldCycleId: string,
  newCycleId: string,
  categories: readonly Category[],
  allocations: readonly BudgetAllocation[]
): BudgetAllocation[] {
  const activeCategoryIds = new Set(categories.filter((category) => !category.archivedAt && category.active).map((category) => category.id));
  return allocations
    .filter((allocation) => !allocation.archivedAt && allocation.budgetCycleId === oldCycleId && activeCategoryIds.has(allocation.categoryId))
    .map((allocation) => ({
      ...createRecordMeta("alloc"),
      budgetCycleId: newCycleId,
      categoryId: allocation.categoryId,
      baseAmountMinor: allocation.baseAmountMinor,
      note: "Copied from previous cycle template."
    }));
}

export function protectedTargetForSalary(salaryDepositText: string): number {
  return percentageOfMinor(parseMoneyInput(salaryDepositText), 1_000);
}
