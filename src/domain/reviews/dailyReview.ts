import { addDays, isOnOrBefore } from "../dates";
import type { BluehourSnapshot, IsoDate, ReviewSession } from "../types";
import { isActive } from "../types";
import { calculateSafeToSpend } from "../forecasting/safeToSpend";
import { createRecordMeta, touchRecord } from "../records";

export interface DailyReviewTask {
  id: string;
  label: string;
  complete: boolean;
  route?: string;
}

export function dailyReviewTasks(snapshot: BluehourSnapshot, asOfDate: IsoDate): DailyReviewTask[] {
  const tasks: DailyReviewTask[] = [];
  const uncategorised = snapshot.transactionSplits.filter((split) => isActive(split) && split.categoryId === "cat-uncategorised").length;
  if (uncategorised > 0) {
    tasks.push({
      id: "uncategorised-transactions",
      label: `Categorise ${uncategorised} uncategorised transaction split${uncategorised === 1 ? "" : "s"}`,
      complete: false,
      route: "/transactions"
    });
  }

  const duePlans = snapshot.planInstances.filter(
    (plan) => isActive(plan) && plan.kind !== "income" && plan.status === "scheduled" && isOnOrBefore(plan.expectedDate, asOfDate)
  );
  if (duePlans.length > 0) {
    tasks.push({
      id: "due-plans",
      label: `Confirm ${duePlans.length} due or overdue planned payment${duePlans.length === 1 ? "" : "s"}`,
      complete: false,
      route: "/plan"
    });
  }

  const uncertainImports = snapshot.importRowAudits.filter((audit) => isActive(audit) && audit.outcome === "uncertain").length;
  if (uncertainImports > 0) {
    tasks.push({
      id: "uncertain-imports",
      label: `Resolve ${uncertainImports} uncertain CSV import match${uncertainImports === 1 ? "" : "es"}`,
      complete: false,
      route: "/review"
    });
  }

  const deferredExtraIncome = snapshot.extraIncomeAllocations.filter((allocation) => isActive(allocation) && allocation.status === "deferred").length;
  if (deferredExtraIncome > 0) {
    tasks.push({
      id: "deferred-extra-income",
      label: `Decide ${deferredExtraIncome} deferred extra-income allocation${deferredExtraIncome === 1 ? "" : "s"}`,
      complete: false,
      route: "/transactions"
    });
  }

  if (snapshot.outboxOperations.length > 0 || snapshot.syncState.some((state) => state.status === "needs_reconnection" || state.status === "failed")) {
    tasks.push({
      id: "sync-pending",
      label: "Reconnect or sync pending local changes",
      complete: false,
      route: "/settings"
    });
  }

  const activeCycle = snapshot.budgetCycles.find((cycle) => isActive(cycle) && cycle.status === "open");
  if (activeCycle) {
    const result = calculateSafeToSpend({
      asOfDate,
      horizonEndDate: addDays(activeCycle.expectedNextSalaryTo, -1),
      cycle: activeCycle,
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
      includeFutureIncome: false
    });
    if (result.shortfallMinor > 0) {
      tasks.push({
        id: "projected-shortfall",
        label: "Inspect the newly projected shortfall",
        complete: false,
        route: "/"
      });
    }
  }

  return tasks.sort((left, right) => left.id.localeCompare(right.id));
}

export function upsertDailyReviewSession(existing: ReviewSession | undefined, tasks: readonly DailyReviewTask[], periodKey: IsoDate): ReviewSession {
  const previous = existing ? parseDailyReviewItems(existing) : [];
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const merged = tasks.map((task) => ({
    ...task,
    complete: previousById.get(task.id)?.complete ?? false
  }));
  const allComplete = merged.length > 0 && merged.every((item) => item.complete);

  if (!existing) {
    return {
      ...createRecordMeta("review"),
      type: "daily",
      periodKey,
      status: allComplete ? "completed" : "open",
      itemsJson: JSON.stringify(merged),
      completedAt: allComplete ? new Date().toISOString() : undefined
    };
  }

  return {
    ...touchRecord(existing),
    type: "daily",
    periodKey,
    status: allComplete ? "completed" : "open",
    itemsJson: JSON.stringify(merged),
    completedAt: allComplete ? existing.completedAt ?? new Date().toISOString() : undefined
  };
}

export function parseDailyReviewItems(review: ReviewSession): DailyReviewTask[] {
  try {
    const parsed = JSON.parse(review.itemsJson) as DailyReviewTask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
