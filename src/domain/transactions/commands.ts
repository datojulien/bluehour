import { applyCategorisationRules } from "../categorisation/rules";
import { normaliseDescription } from "../imports/duplicateMatching";
import { assertIntegerMinor } from "../money";
import { createRecordMeta, touchRecord } from "../records";
import type {
  BluehourSnapshot,
  CategorisationRule,
  IsoDate,
  PlanInstance,
  Transaction,
  TransactionLeg,
  TransactionSplit,
  TransactionType
} from "../types";
import { isActive } from "../types";
import { validateSplits, validateTransferLegs } from "./calculations";

export interface SplitDraft {
  categoryId: string;
  amountMinor: number;
}

export interface TransactionDraft {
  type: TransactionType;
  occurredOn: IsoDate;
  description: string;
  amountMinor: number;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  splits?: SplitDraft[];
  note?: string;
  planInstanceId?: string;
  refundOfTransactionId?: string;
  feeMinor?: number;
  feeCategoryId?: string;
  importBatchId?: string;
  importFingerprint?: string;
  source?: Transaction["source"];
}

export interface TransactionCommandResult {
  transaction: Transaction;
  legs: TransactionLeg[];
  splits: TransactionSplit[];
  updatedPlan?: PlanInstance;
  updatedRule?: CategorisationRule;
}

export function createTransactionRecords(draft: TransactionDraft, snapshot: BluehourSnapshot): TransactionCommandResult {
  assertIntegerMinor(draft.amountMinor);
  if (draft.amountMinor <= 0) {
    throw new Error("Transaction amount must be greater than RM0.00");
  }

  const source = draft.source ?? "manual";
  const transaction: Transaction = {
    ...createRecordMeta("txn"),
    type: draft.type,
    status: "actual",
    occurredOn: draft.occurredOn,
    description: draft.description.trim(),
    merchantNormalized: normaliseDescription(draft.description),
    note: draft.note?.trim() || undefined,
    source,
    planInstanceId: draft.planInstanceId || undefined,
    refundOfTransactionId: draft.refundOfTransactionId || undefined,
    importBatchId: draft.importBatchId,
    importFingerprint: draft.importFingerprint
  };

  const ruleMatch =
    draft.categoryId || draft.type === "transfer"
      ? null
      : applyCategorisationRules(
          {
            description: draft.description,
            accountId: draft.accountId,
            amountMinor: draft.amountMinor
          },
          snapshot.categorisationRules
        );
  const selectedCategoryId = draft.categoryId ?? ruleMatch?.rule.categoryId;

  const legs = buildLegs(transaction, draft);
  const splits = buildSplits(transaction, draft, selectedCategoryId);
  const updatedPlan = draft.planInstanceId ? planToFulfil(draft.planInstanceId, snapshot.planInstances) : undefined;

  return {
    transaction,
    legs,
    splits,
    updatedPlan: updatedPlan
      ? {
          ...touchRecord(updatedPlan),
          status: "fulfilled",
          linkedTransactionId: transaction.id
        }
      : undefined,
    updatedRule: ruleMatch?.updatedRule
  };
}

function planToFulfil(planInstanceId: string, plans: readonly PlanInstance[]): PlanInstance {
  const plan = plans.find((item) => item.id === planInstanceId && isActive(item));
  if (!plan) {
    throw new Error("Planned item could not be found");
  }

  if (plan.status !== "scheduled") {
    throw new Error("Planned item has already been fulfilled or closed");
  }

  return plan;
}

function buildLegs(transaction: Transaction, draft: TransactionDraft): TransactionLeg[] {
  const feeMinor = draft.feeMinor ?? 0;
  assertIntegerMinor(feeMinor, "fee");

  if (draft.type === "transfer") {
    if (!draft.toAccountId) {
      throw new Error("Transfer requires a destination account");
    }

    const legs = [
      leg(transaction.id, draft.accountId, -(draft.amountMinor + feeMinor)),
      leg(transaction.id, draft.toAccountId, draft.amountMinor)
    ];
    validateTransferLegs(legs, feeMinor);
    return legs;
  }

  if (draft.type === "income") {
    return [leg(transaction.id, draft.accountId, draft.amountMinor)];
  }

  if (draft.type === "refund" || draft.type === "reimbursement") {
    return [leg(transaction.id, draft.accountId, draft.amountMinor)];
  }

  if (draft.type === "reconciliation_adjustment" || draft.type === "opening_adjustment") {
    return [leg(transaction.id, draft.accountId, draft.amountMinor)];
  }

  return [leg(transaction.id, draft.accountId, -draft.amountMinor)];
}

function buildSplits(transaction: Transaction, draft: TransactionDraft, selectedCategoryId?: string): TransactionSplit[] {
  if (draft.type === "transfer" && !draft.feeMinor) {
    return [];
  }

  if (draft.splits && draft.splits.length > 0) {
    validateSplits(draft.amountMinor, draft.splits.map((split) => ({ direction: directionForType(draft.type), amountMinor: split.amountMinor })));
    return draft.splits.map((splitDraft) => split(transaction.id, splitDraft.categoryId, directionForType(draft.type), splitDraft.amountMinor));
  }

  if (draft.type === "transfer") {
    if (!draft.feeMinor || !draft.feeCategoryId) {
      return [];
    }
    return [split(transaction.id, draft.feeCategoryId, "expense", draft.feeMinor)];
  }

  if (!selectedCategoryId) {
    throw new Error("Transaction requires a category or a matching categorisation rule");
  }

  return [split(transaction.id, selectedCategoryId, directionForType(draft.type), draft.amountMinor)];
}

function directionForType(type: TransactionType): TransactionSplit["direction"] {
  if (type === "income") {
    return "income";
  }

  if (type === "refund" || type === "reimbursement") {
    return "reversal";
  }

  return "expense";
}

function leg(transactionId: string, accountId: string, deltaMinor: number): TransactionLeg {
  return {
    ...createRecordMeta("leg"),
    transactionId,
    accountId,
    deltaMinor
  };
}

function split(
  transactionId: string,
  categoryId: string,
  direction: TransactionSplit["direction"],
  amountMinor: number
): TransactionSplit {
  return {
    ...createRecordMeta("split"),
    transactionId,
    categoryId,
    direction,
    amountMinor
  };
}
