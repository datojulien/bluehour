import { isWithinInclusive } from "../dates";
import type { BluehourSnapshot, BudgetCycle, IsoDate } from "../types";
import { isActive } from "../types";

export function calculateCompletedProtectedTransfers(snapshot: BluehourSnapshot, cycle: BudgetCycle, asOfDate: IsoDate): number {
  const protectedAccountIds = new Set(snapshot.accounts.filter((account) => isActive(account) && account.role === "protected").map((account) => account.id));
  const transactionById = new Map(snapshot.transactions.filter(isActive).map((transaction) => [transaction.id, transaction]));

  return snapshot.transactionLegs
    .filter((leg) => {
      const transaction = transactionById.get(leg.transactionId);
      return (
        isActive(leg) &&
        protectedAccountIds.has(leg.accountId) &&
        leg.deltaMinor > 0 &&
        transaction?.type === "transfer" &&
        isWithinInclusive(transaction.occurredOn, cycle.startedOn, asOfDate)
      );
    })
    .reduce((total, leg) => total + leg.deltaMinor, 0);
}
