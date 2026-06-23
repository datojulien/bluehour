import { addMonthsClamped, daysBetweenInclusive } from "../dates";
import { createRecordMeta, touchRecord } from "../records";
import type { BudgetCycle, IsoDate, SavingsGoal, SavingsGoalContribution } from "../types";
import { isActive } from "../types";

export interface SavingsGoalDraft {
  name: string;
  targetMinor: number;
  currentManualMinor?: number;
  deadline?: IsoDate;
  priority: SavingsGoal["priority"];
  linkedAccountId?: string;
  linkedCategoryId?: string;
  status?: SavingsGoal["status"];
  notes?: string;
}

export interface SavingsGoalProgress {
  goal: SavingsGoal;
  contributedMinor: number;
  currentMinor: number;
  remainingMinor: number;
  percentageComplete: number;
  requiredPerCycleMinor: number;
  requiredPerMonthMinor: number;
  recentContributions: SavingsGoalContribution[];
}

export function createSavingsGoal(draft: SavingsGoalDraft): SavingsGoal {
  validateGoalDraft(draft);
  return {
    ...createRecordMeta("goal"),
    name: draft.name.trim(),
    targetMinor: draft.targetMinor,
    currentManualMinor: draft.currentManualMinor,
    deadline: draft.deadline,
    priority: draft.priority,
    linkedAccountId: draft.linkedAccountId,
    linkedCategoryId: draft.linkedCategoryId,
    status: draft.status ?? "active",
    notes: draft.notes?.trim() || undefined
  };
}

export function updateSavingsGoal(goal: SavingsGoal, draft: SavingsGoalDraft): SavingsGoal {
  validateGoalDraft(draft);
  return {
    ...touchRecord(goal),
    name: draft.name.trim(),
    targetMinor: draft.targetMinor,
    currentManualMinor: draft.currentManualMinor,
    deadline: draft.deadline,
    priority: draft.priority,
    linkedAccountId: draft.linkedAccountId,
    linkedCategoryId: draft.linkedCategoryId,
    status: draft.status ?? goal.status,
    notes: draft.notes?.trim() || undefined
  };
}

export function savingsGoalContribution({
  goalId,
  amountMinor,
  occurredOn,
  source,
  status,
  linkedTransactionId,
  linkedBudgetCycleId,
  note
}: {
  goalId: string;
  amountMinor: number;
  occurredOn: IsoDate;
  source: SavingsGoalContribution["source"];
  status?: SavingsGoalContribution["status"];
  linkedTransactionId?: string;
  linkedBudgetCycleId?: string;
  note?: string;
}): SavingsGoalContribution {
  if (amountMinor <= 0 || !Number.isInteger(amountMinor)) {
    throw new Error("Savings goal contribution must be a positive integer sen value.");
  }
  const derivedStatus = status ?? (source === "manual" ? "manual" : linkedTransactionId ? "completed" : "pending_transfer");
  return {
    ...createRecordMeta("goal-contribution"),
    savingsGoalId: goalId,
    amountMinor,
    occurredOn,
    source,
    status: derivedStatus,
    linkedTransactionId,
    linkedBudgetCycleId,
    note: note?.trim() || undefined
  };
}

export function linkSavingsContribution(contribution: SavingsGoalContribution, transactionId: string): SavingsGoalContribution {
  return {
    ...touchRecord(contribution),
    linkedTransactionId: transactionId,
    status: "completed"
  };
}

export function pendingProtectedSavingsMinor(contributions: readonly SavingsGoalContribution[], cycle?: BudgetCycle): number {
  return contributions
    .filter(
      (contribution) =>
        isActive(contribution) &&
        contribution.status === "pending_transfer" &&
        (!cycle || !contribution.linkedBudgetCycleId || contribution.linkedBudgetCycleId === cycle.id)
    )
    .reduce((total, contribution) => total + contribution.amountMinor, 0);
}

export function buildSavingsGoalProgress(
  goals: readonly SavingsGoal[],
  contributions: readonly SavingsGoalContribution[],
  asOfDate: IsoDate,
  cycle?: BudgetCycle
): SavingsGoalProgress[] {
  return goals
    .filter(isActive)
    .map((goal) => {
      const goalContributions = contributions
        .filter((contribution) => isActive(contribution) && contribution.savingsGoalId === goal.id && contribution.status !== "pending_transfer")
        .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn) || right.createdAt.localeCompare(left.createdAt));
      const contributedMinor = goalContributions.reduce((total, contribution) => total + contribution.amountMinor, 0);
      const currentMinor = (goal.currentManualMinor ?? 0) + contributedMinor;
      const remainingMinor = Math.max(0, goal.targetMinor - currentMinor);
      const remainingDays = goal.deadline ? daysBetweenInclusive(asOfDate, goal.deadline) : 0;
      const cycleLength = cycle ? daysBetweenInclusive(cycle.startedOn, cycle.expectedNextSalaryTo) : 31;
      const cyclesRemaining = remainingDays > 0 ? Math.max(1, Math.floor((remainingDays + cycleLength - 1) / cycleLength)) : 1;
      const monthsRemaining = goal.deadline ? monthsUntil(asOfDate, goal.deadline) : 1;
      return {
        goal,
        contributedMinor,
        currentMinor,
        remainingMinor,
        percentageComplete: goal.targetMinor > 0 ? Math.min(100, Math.floor((currentMinor * 100 + Math.floor(goal.targetMinor / 2)) / goal.targetMinor)) : 0,
        requiredPerCycleMinor: Math.floor((remainingMinor + Math.floor(cyclesRemaining / 2)) / cyclesRemaining),
        requiredPerMonthMinor: goal.deadline ? Math.floor((remainingMinor + Math.floor(monthsRemaining / 2)) / monthsRemaining) : remainingMinor,
        recentContributions: goalContributions.slice(0, 4)
      };
    });
}

function monthsUntil(asOfDate: IsoDate, deadline: IsoDate): number {
  let months = 1;
  while (addMonthsClamped(asOfDate, months) < deadline && months < 120) {
    months += 1;
  }
  return Math.max(1, months);
}

function validateGoalDraft(draft: SavingsGoalDraft): void {
  if (!draft.name.trim()) {
    throw new Error("Savings goal name is required.");
  }
  if (draft.targetMinor <= 0 || !Number.isInteger(draft.targetMinor)) {
    throw new Error("Savings goal target must be a positive integer sen value.");
  }
  if (draft.currentManualMinor !== undefined && (draft.currentManualMinor < 0 || !Number.isInteger(draft.currentManualMinor))) {
    throw new Error("Manual progress must be a non-negative integer sen value.");
  }
}
