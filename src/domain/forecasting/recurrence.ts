import { addDays, addMonthsClamped, compareIsoDate, isOnOrBefore } from "../dates";
import type { IsoDate, PlanInstance, RecurringRule } from "../types";

export function generateRecurringPlanInstances(rule: RecurringRule, fromDate: IsoDate, toDate: IsoDate): PlanInstance[] {
  if (!rule.active) {
    return [];
  }

  const instances: PlanInstance[] = [];
  let cursor = rule.startDate;
  let index = 0;

  while (compareIsoDate(cursor, fromDate) < 0) {
    cursor = advance(rule, cursor);
    index += 1;
  }

  while (isOnOrBefore(cursor, toDate) && (!rule.endDate || isOnOrBefore(cursor, rule.endDate))) {
    const now = new Date().toISOString();
    instances.push({
      id: `${rule.id}-${cursor}`,
      recurringRuleId: rule.id,
      kind: rule.kind === "subscription" ? "expense" : rule.kind,
      name: rule.name,
      expectedDate: cursor,
      expectedAmountMinor: rule.amountMinor,
      confidence: rule.kind === "income" ? "confirmed" : "expected",
      reservation: "reserved",
      status: "scheduled",
      categoryId: rule.categoryId,
      accountId: rule.fromAccountId ?? rule.toAccountId,
      fromAccountId: rule.fromAccountId,
      toAccountId: rule.toAccountId,
      essential: rule.essential,
      createdAt: now,
      updatedAt: now,
      revision: 1
    });

    cursor = advance(rule, cursor);
    index += 1;
    if (index > 520) {
      throw new Error("Recurring rule generated too many instances");
    }
  }

  return instances;
}

function advance(rule: RecurringRule, date: IsoDate): IsoDate {
  const interval = Math.max(1, rule.interval);

  switch (rule.frequency) {
    case "weekly":
      return addDays(date, 7 * interval);
    case "monthly":
      return addMonthsClamped(date, interval, rule.dayOfMonth);
    case "quarterly":
      return addMonthsClamped(date, 3 * interval, rule.dayOfMonth);
    case "yearly":
      return addMonthsClamped(date, 12 * interval, rule.dayOfMonth);
    case "custom":
      return addDays(date, interval);
  }
}
