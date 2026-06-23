import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import { addDays } from "../dates";
import type { CoachInsightDecision } from "../types";
import { defaultSavingsCoachPreferences, readSavingsCoachPreferences, savingsCoachPreferenceRecord } from "./preferences";
import { evaluatePurchaseCheck } from "./purchaseCheck";
import { detectSaveDifferenceOpportunities, saveDifferenceAmount } from "./saveDifference";
import { buildSavingsCycleReview } from "./savingsCycleReview";
import { buildSavingsGoalProgress, createSavingsGoal, pendingProtectedSavingsMinor, savingsGoalContribution } from "./savingsGoals";
import { detectSpendingLeaks } from "./spendingLeakDetector";

describe("Savings Coach domain", () => {
  it("reads and writes Savings Coach preferences inside the preferences setting", () => {
    const snapshot = createDemoSnapshot();
    const preferences = readSavingsCoachPreferences(snapshot.settings);

    const record = savingsCoachPreferenceRecord(snapshot.settings, {
      ...preferences,
      insightSensitivity: "strict",
      merchantWatchlist: ["coffee", "orchid"]
    });
    const next = readSavingsCoachPreferences([record]);

    expect(preferences.enabled).toBe(true);
    expect(next.insightSensitivity).toBe("strict");
    expect(next.merchantWatchlist).toEqual(["coffee", "orchid"]);
  });

  it("falls back to deterministic defaults when preferences are absent", () => {
    expect(readSavingsCoachPreferences([])).toEqual(defaultSavingsCoachPreferences);
  });

  it("detects subscription and watchlist spending insights, then filters dismissed insight decisions", () => {
    const snapshot = createDemoSnapshot();
    const cycle = snapshot.budgetCycles[0];
    const preferences = readSavingsCoachPreferences(snapshot.settings);
    const insights = detectSpendingLeaks(snapshot, cycle, demoAsOfDate, preferences);
    const fingerprint = insights[0]?.fingerprint ?? "";
    const decision: CoachInsightDecision = {
      id: "coach-decision-test",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
      archivedAt: null,
      revision: 1,
      insightFingerprint: fingerprint,
      decision: "dismissed",
      decidedAt: "2026-07-12T00:00:00.000Z"
    };

    const filtered = detectSpendingLeaks({ ...snapshot, coachInsightDecisions: [decision] }, cycle, demoAsOfDate, preferences);

    expect(insights.map((insight) => insight.kind)).toContain("subscription_review");
    expect(insights.map((insight) => insight.kind)).toContain("watchlist_merchant");
    expect(filtered.map((insight) => insight.fingerprint)).not.toContain(fingerprint);
  });

  it("surfaces underspent discretionary envelopes for Save-the-Difference", () => {
    const snapshot = createDemoSnapshot();
    const opportunities = detectSaveDifferenceOpportunities(snapshot, snapshot.budgetCycles[0], demoAsOfDate);
    const dining = opportunities.find((opportunity) => opportunity.categoryId === "cat-dining");

    expect(dining?.categoryName).toBe("Dining Out");
    expect(dining?.suggestedMoveMinor).toBeGreaterThan(0);
    expect(saveDifferenceAmount(dining!, "all")).toBe(dining?.maximumMoveMinor);
  });

  it("evaluates purchases against safe-to-spend and category remaining amounts", () => {
    const snapshot = createDemoSnapshot();
    const cycle = snapshot.budgetCycles[0];
    const safe = evaluatePurchaseCheck(snapshot, cycle, demoAsOfDate, {
      label: "Coffee",
      amountMinor: 1_000,
      categoryId: "cat-dining",
      intendedDate: demoAsOfDate
    });
    const notRecommended = evaluatePurchaseCheck(snapshot, cycle, demoAsOfDate, {
      label: "Laptop",
      amountMinor: 500_000,
      categoryId: "cat-shopping",
      intendedDate: addDays(demoAsOfDate, 1)
    });

    expect(safe.result).toBe("safe");
    expect(safe.safeToSpendAfterMinor).toBeLessThan(safe.safeToSpendBeforeMinor);
    expect(notRecommended.result).toBe("not_recommended");
    expect(notRecommended.explanations.join(" ")).toMatch(/exceed|over/);
  });

  it("tracks goal progress and pending protected savings without counting pending transfers as completed", () => {
    const goal = createSavingsGoal({
      name: "Holiday buffer",
      targetMinor: 100_000,
      currentManualMinor: 10_000,
      deadline: "2026-12-31",
      priority: "normal"
    });
    const manual = savingsGoalContribution({
      goalId: goal.id,
      amountMinor: 15_000,
      occurredOn: demoAsOfDate,
      source: "manual",
      status: "manual"
    });
    const pending = savingsGoalContribution({
      goalId: goal.id,
      amountMinor: 20_000,
      occurredOn: demoAsOfDate,
      source: "save_difference",
      status: "pending_transfer",
      linkedBudgetCycleId: "cycle-2026-06-24"
    });
    const progress = buildSavingsGoalProgress([goal], [manual, pending], demoAsOfDate, createDemoSnapshot().budgetCycles[0])[0];

    expect(progress.currentMinor).toBe(25_000);
    expect(progress.remainingMinor).toBe(75_000);
    expect(pendingProtectedSavingsMinor([manual, pending], createDemoSnapshot().budgetCycles[0])).toBe(20_000);
  });

  it("builds a cycle savings review from protected progress, goals, insights, and difference opportunities", () => {
    const snapshot = createDemoSnapshot();
    const review = buildSavingsCycleReview(snapshot, snapshot.budgetCycles[0], demoAsOfDate, readSavingsCoachPreferences(snapshot.settings));

    expect(review.protectedTargetMinor).toBe(78_000);
    expect(review.completedProtectedMinor).toBe(80_000);
    expect(review.activeGoalCount).toBe(1);
    expect(review.saveDifferenceAvailableMinor).toBeGreaterThan(0);
    expect(review.topSuggestions.length).toBeGreaterThan(0);
  });
});
