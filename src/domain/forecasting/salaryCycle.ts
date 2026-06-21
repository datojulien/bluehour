import { addDays, addMonthsClamped } from "../dates";
import type { BudgetCycle, IsoDate } from "../types";

export function nextSalaryWindowFromStart(
  cycleStartedOn: IsoDate,
  windowStartDay: number,
  windowEndDay: number
): { expectedNextSalaryFrom: IsoDate; expectedNextSalaryTo: IsoDate } {
  const from = addMonthsClamped(cycleStartedOn, 1, windowStartDay);
  const to = addMonthsClamped(cycleStartedOn, 1, windowEndDay);
  return {
    expectedNextSalaryFrom: from,
    expectedNextSalaryTo: to
  };
}

export function closeCycleForActualSalary(
  previousCycle: BudgetCycle,
  actualSalaryDate: IsoDate,
  salaryTransactionId: string,
  salaryAmountMinor: number
): { closedCycle: BudgetCycle; newCycle: BudgetCycle } {
  const nextWindow = nextSalaryWindowFromStart(actualSalaryDate, 24, 26);
  const now = new Date().toISOString();

  return {
    closedCycle: {
      ...previousCycle,
      endedOn: addDays(actualSalaryDate, -1),
      status: "closed",
      closedAt: now,
      updatedAt: now,
      revision: previousCycle.revision + 1
    },
    newCycle: {
      ...previousCycle,
      id: `${previousCycle.id}-next`,
      startedOn: actualSalaryDate,
      endedOn: undefined,
      status: "open",
      salaryTransactionId,
      expectedNextSalaryFrom: nextWindow.expectedNextSalaryFrom,
      expectedNextSalaryTo: nextWindow.expectedNextSalaryTo,
      actualMainSalaryMinor: salaryAmountMinor,
      closedAt: undefined,
      createdAt: now,
      updatedAt: now,
      revision: 1
    }
  };
}
