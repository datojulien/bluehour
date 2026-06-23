import { buildBudgetProgressRows } from "../budgets/budgetProgress";
import { percentageOfMinor } from "../money";
import { pendingProtectedExtraIncomeMinor } from "../income/extraIncomeAllocation";
import { calculateCompletedProtectedTransfers } from "../forecasting/protectedProgress";
import type { BluehourSnapshot, BudgetCycle, IsoDate } from "../types";
import { buildSavingsGoalProgress, pendingProtectedSavingsMinor } from "./savingsGoals";
import { detectSaveDifferenceOpportunities } from "./saveDifference";
import { detectSpendingLeaks } from "./spendingLeakDetector";
import type { SavingsCoachPreferences } from "./preferences";

export interface SavingsCycleReview {
  protectedTargetMinor: number;
  completedProtectedMinor: number;
  pendingProtectedMinor: number;
  remainingProtectedMinor: number;
  saveDifferenceAvailableMinor: number;
  overspentCategoryCount: number;
  underPaceCategoryCount: number;
  activeGoalCount: number;
  goalRemainingMinor: number;
  topSuggestions: string[];
}

export function buildSavingsCycleReview(
  snapshot: BluehourSnapshot,
  cycle: BudgetCycle,
  asOfDate: IsoDate,
  preferences: SavingsCoachPreferences
): SavingsCycleReview {
  const protectedTargetMinor =
    percentageOfMinor(cycle.actualMainSalaryMinor, cycle.protectedRateBasisPoints) +
    (cycle.additionalProtectedCommitmentMinor ?? 0) +
    pendingProtectedExtraIncomeMinor(snapshot, cycle) +
    pendingProtectedSavingsMinor(snapshot.savingsGoalContributions, cycle);
  const completedProtectedMinor = calculateCompletedProtectedTransfers(snapshot, cycle, asOfDate);
  const pendingProtectedMinor = pendingProtectedSavingsMinor(snapshot.savingsGoalContributions, cycle);
  const remainingProtectedMinor = Math.max(0, protectedTargetMinor - completedProtectedMinor);
  const budgetRows = buildBudgetProgressRows({ snapshot, cycle, asOfDate });
  const saveDifference = detectSaveDifferenceOpportunities(snapshot, cycle, asOfDate);
  const goalProgress = buildSavingsGoalProgress(snapshot.savingsGoals, snapshot.savingsGoalContributions, asOfDate, cycle).filter(
    (progress) => progress.goal.status === "active"
  );
  const insights = detectSpendingLeaks(snapshot, cycle, asOfDate, preferences);
  const saveDifferenceAvailableMinor = saveDifference.reduce((total, opportunity) => total + opportunity.suggestedMoveMinor, 0);
  const goalRemainingMinor = goalProgress.reduce((total, progress) => total + progress.remainingMinor, 0);

  return {
    protectedTargetMinor,
    completedProtectedMinor,
    pendingProtectedMinor,
    remainingProtectedMinor,
    saveDifferenceAvailableMinor,
    overspentCategoryCount: budgetRows.filter((row) => row.state === "overspent").length,
    underPaceCategoryCount: saveDifference.length,
    activeGoalCount: goalProgress.length,
    goalRemainingMinor,
    topSuggestions: buildSuggestions({
      remainingProtectedMinor,
      saveDifferenceAvailableMinor,
      overspentCategoryCount: budgetRows.filter((row) => row.state === "overspent").length,
      insightCount: insights.length,
      activeGoalCount: goalProgress.length
    })
  };
}

function buildSuggestions({
  remainingProtectedMinor,
  saveDifferenceAvailableMinor,
  overspentCategoryCount,
  insightCount,
  activeGoalCount
}: {
  remainingProtectedMinor: number;
  saveDifferenceAvailableMinor: number;
  overspentCategoryCount: number;
  insightCount: number;
  activeGoalCount: number;
}): string[] {
  const suggestions: string[] = [];
  if (remainingProtectedMinor > 0) {
    suggestions.push("Confirm any planned protected transfer before closing the salary cycle.");
  }
  if (saveDifferenceAvailableMinor > 0 && activeGoalCount > 0) {
    suggestions.push("Review Save-the-Difference opportunities and explicitly choose any goal contribution.");
  }
  if (saveDifferenceAvailableMinor > 0 && activeGoalCount === 0) {
    suggestions.push("Create a savings goal before converting underspend into protected savings.");
  }
  if (overspentCategoryCount > 0) {
    suggestions.push("Check overspent categories before transferring money out of any budget.");
  }
  if (insightCount > 0) {
    suggestions.push("Dismiss, snooze, or convert the current coach insights so the next review stays focused.");
  }
  return suggestions.slice(0, 5);
}
