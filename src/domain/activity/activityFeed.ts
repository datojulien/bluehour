import type { BluehourSnapshot, IsoDate } from "../types";
import { isActive } from "../types";

export interface ActivityItem {
  id: string;
  occurredAt: string;
  localDate: IsoDate;
  type: string;
  label: string;
  detail?: string;
  amountMinor?: number;
  route?: string;
}

export function buildActivityFeed(snapshot: BluehourSnapshot, limit = 10): ActivityItem[] {
  const items: ActivityItem[] = [
    ...transactionActivities(snapshot),
    ...planFulfilmentActivities(snapshot),
    ...budgetTransferActivities(snapshot),
    ...reconciliationActivities(snapshot),
    ...subscriptionPriceActivities(snapshot),
    ...importActivities(snapshot),
    ...cycleActivities(snapshot)
  ];

  return items
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.localDate.localeCompare(left.localDate) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

function transactionActivities(snapshot: BluehourSnapshot): ActivityItem[] {
  return snapshot.transactions.filter(isActive).map((transaction) => ({
    id: `transaction:${transaction.id}`,
    occurredAt: transaction.updatedAt,
    localDate: transaction.occurredOn,
    type: "transaction",
    label: transaction.description,
    detail: transaction.type.replaceAll("_", " "),
    amountMinor: transactionAmount(transaction.id, snapshot),
    route: "/transactions"
  }));
}

function planFulfilmentActivities(snapshot: BluehourSnapshot): ActivityItem[] {
  return snapshot.planInstances
    .filter((plan) => isActive(plan) && plan.status === "fulfilled" && plan.linkedTransactionId)
    .map((plan) => ({
      id: `plan-fulfilment:${plan.id}`,
      occurredAt: plan.updatedAt,
      localDate: plan.expectedDate,
      type: "plan_fulfilment",
      label: `${plan.name} fulfilled`,
      detail: "Planned item linked to an actual transaction.",
      amountMinor: plan.expectedAmountMinor,
      route: "/plan"
    }));
}

function budgetTransferActivities(snapshot: BluehourSnapshot): ActivityItem[] {
  const categories = new Map(snapshot.categories.map((category) => [category.id, category.name]));
  return snapshot.budgetTransfers.filter(isActive).map((transfer) => ({
    id: `budget-transfer:${transfer.id}`,
    occurredAt: transfer.updatedAt,
    localDate: transfer.occurredOn,
    type: "budget_transfer",
    label: "Budget moved",
    detail: `${categories.get(transfer.fromCategoryId) ?? transfer.fromCategoryId} to ${categories.get(transfer.toCategoryId) ?? transfer.toCategoryId}`,
    amountMinor: transfer.amountMinor,
    route: "/budgets"
  }));
}

function reconciliationActivities(snapshot: BluehourSnapshot): ActivityItem[] {
  const accounts = new Map(snapshot.accounts.map((account) => [account.id, account.name]));
  return snapshot.reconciliations.filter(isActive).map((reconciliation) => ({
    id: `reconciliation:${reconciliation.id}`,
    occurredAt: reconciliation.updatedAt,
    localDate: reconciliation.asOfDate,
    type: "reconciliation",
    label: `${accounts.get(reconciliation.accountId) ?? "Account"} reconciled`,
    detail: reconciliation.status,
    amountMinor: reconciliation.differenceMinor,
    route: "/review"
  }));
}

function subscriptionPriceActivities(snapshot: BluehourSnapshot): ActivityItem[] {
  return snapshot.subscriptions.filter(isActive).flatMap((subscription) =>
    parsePriceHistory(subscription.priceHistoryJson).map((entry) => ({
      id: `subscription-price:${subscription.id}:${entry.changedAt}`,
      occurredAt: entry.changedAt,
      localDate: entry.effectiveDate,
      type: "subscription_price",
      label: `${subscription.provider} price changed`,
      detail: "Subscription price history updated.",
      amountMinor: entry.nextAmountMinor - entry.previousAmountMinor,
      route: "/subscriptions"
    }))
  );
}

function importActivities(snapshot: BluehourSnapshot): ActivityItem[] {
  return snapshot.importBatches.filter(isActive).map((batch) => ({
    id: `import:${batch.id}`,
    occurredAt: batch.importedAt,
    localDate: batch.importedAt.slice(0, 10) as IsoDate,
    type: "csv_import",
    label: `Imported ${batch.fileName}`,
    detail: `${batch.newCount} new, ${batch.matchedCount} linked, ${batch.reviewCount} to review`,
    route: "/transactions"
  }));
}

function cycleActivities(snapshot: BluehourSnapshot): ActivityItem[] {
  return snapshot.budgetCycles.filter(isActive).flatMap((cycle) => {
    const opened: ActivityItem = {
      id: `cycle-open:${cycle.id}`,
      occurredAt: cycle.createdAt,
      localDate: cycle.startedOn,
      type: "cycle_open",
      label: "Salary cycle opened",
      detail: cycle.status,
      amountMinor: cycle.actualMainSalaryMinor,
      route: "/review"
    };
    if (!cycle.closedAt || !cycle.endedOn) {
      return [opened];
    }
    return [
      opened,
      {
        id: `cycle-close:${cycle.id}`,
        occurredAt: cycle.closedAt,
        localDate: cycle.endedOn,
        type: "cycle_close",
        label: "Salary cycle closed",
        detail: cycle.status,
        route: "/review"
      }
    ];
  });
}

function transactionAmount(transactionId: string, snapshot: BluehourSnapshot): number {
  const splits = snapshot.transactionSplits.filter((split) => isActive(split) && split.transactionId === transactionId);
  if (splits.length > 0) {
    return splits.reduce((total, split) => {
      if (split.direction === "expense") {
        return total - split.amountMinor;
      }
      return total + split.amountMinor;
    }, 0);
  }

  return snapshot.transactionLegs
    .filter((leg) => isActive(leg) && leg.transactionId === transactionId)
    .reduce((total, leg) => total + leg.deltaMinor, 0);
}

function parsePriceHistory(value: string | undefined): Array<{ changedAt: string; effectiveDate: IsoDate; previousAmountMinor: number; nextAmountMinor: number }> {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as Array<{ changedAt: string; effectiveDate: IsoDate; previousAmountMinor: number; nextAmountMinor: number }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
