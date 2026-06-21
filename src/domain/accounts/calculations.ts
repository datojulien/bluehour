import { compareIsoDate, isOnOrBefore } from "../dates";
import type { Account, BalanceSnapshot, IsoDate, Transaction, TransactionLeg } from "../types";
import { isActive } from "../types";

export interface AccountBalance {
  account: Account;
  balanceMinor: number;
  snapshot?: BalanceSnapshot;
}

export function calculateAccountBalance(
  account: Account,
  snapshots: readonly BalanceSnapshot[],
  transactions: readonly Transaction[],
  legs: readonly TransactionLeg[],
  asOfDate: IsoDate
): AccountBalance {
  const activeSnapshots = snapshots
    .filter((snapshot) => isActive(snapshot) && snapshot.accountId === account.id && isOnOrBefore(snapshot.asOfDate, asOfDate))
    .sort((left, right) => compareIsoDate(right.asOfDate, left.asOfDate));
  const snapshot = activeSnapshots[0];
  const snapshotDate = snapshot?.asOfDate;
  const activeTransactionIds = new Set(
    transactions
      .filter((transaction) => {
        if (!isActive(transaction) || transaction.status !== "actual" || isOnOrBefore(transaction.occurredOn, asOfDate) === false) {
          return false;
        }

        return snapshotDate ? compareIsoDate(transaction.occurredOn, snapshotDate) > 0 : true;
      })
      .map((transaction) => transaction.id)
  );

  const delta = legs
    .filter((leg) => isActive(leg) && leg.accountId === account.id && activeTransactionIds.has(leg.transactionId))
    .reduce((total, leg) => total + leg.deltaMinor, 0);

  return {
    account,
    balanceMinor: (snapshot?.amountMinor ?? 0) + delta,
    snapshot
  };
}

export function calculateAccountBalances(
  accounts: readonly Account[],
  snapshots: readonly BalanceSnapshot[],
  transactions: readonly Transaction[],
  legs: readonly TransactionLeg[],
  asOfDate: IsoDate
): AccountBalance[] {
  return accounts
    .filter(isActive)
    .map((account) => calculateAccountBalance(account, snapshots, transactions, legs, asOfDate));
}

export function calculateNetSpendableBalance(accountBalances: readonly AccountBalance[]): number {
  return accountBalances.reduce((total, accountBalance) => {
    const { account, balanceMinor } = accountBalance;
    if (account.role === "spendable" || account.type === "credit_card") {
      return total + balanceMinor;
    }

    return total;
  }, 0);
}

export function calculateNetWorth(accountBalances: readonly AccountBalance[]): number {
  return accountBalances.reduce((total, accountBalance) => {
    const { account, balanceMinor } = accountBalance;
    if (account.role === "liability") {
      return total + balanceMinor;
    }

    return total + balanceMinor;
  }, 0);
}
