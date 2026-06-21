import { isWithinInclusive } from "../dates";
import type { IsoDate, SplitDirection, Transaction, TransactionLeg, TransactionSplit } from "../types";
import { isActive } from "../types";

export interface SplitInput {
  direction: SplitDirection;
  amountMinor: number;
}

export function validateSplits(requiredAmountMinor: number, splits: readonly SplitInput[]): void {
  const total = splits.reduce((sum, split) => sum + split.amountMinor, 0);
  if (total !== requiredAmountMinor) {
    throw new Error(`Split total ${total} does not equal required amount ${requiredAmountMinor}`);
  }
}

export function validateTransferLegs(legs: readonly Pick<TransactionLeg, "deltaMinor">[], feeExpenseMinor = 0): void {
  const accountLegTotal = legs.reduce((sum, leg) => sum + leg.deltaMinor, 0);
  if (accountLegTotal + feeExpenseMinor !== 0) {
    throw new Error("Transfer account legs must sum to zero after excluding explicit fee expense");
  }
}

export function calculateCategoryActuals(
  categoryId: string,
  transactions: readonly Transaction[],
  splits: readonly TransactionSplit[],
  startDate: IsoDate,
  endDate: IsoDate
): number {
  const activeTransactionIds = new Set(
    transactions
      .filter((transaction) => isActive(transaction) && isWithinInclusive(transaction.occurredOn, startDate, endDate))
      .map((transaction) => transaction.id)
  );

  return splits
    .filter((split) => isActive(split) && split.categoryId === categoryId && activeTransactionIds.has(split.transactionId))
    .reduce((total, split) => {
      if (split.direction === "expense") {
        return total + split.amountMinor;
      }

      if (split.direction === "reversal") {
        return total - split.amountMinor;
      }

      return total;
    }, 0);
}

export function calculateRefundReversalAmount(
  refundTransactionId: string,
  splits: readonly TransactionSplit[]
): number {
  return splits
    .filter((split) => isActive(split) && split.transactionId === refundTransactionId && split.direction === "reversal")
    .reduce((total, split) => total + split.amountMinor, 0);
}
