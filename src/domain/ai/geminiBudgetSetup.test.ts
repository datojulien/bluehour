import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import { defaultBudgetCoachPreferences, type BudgetCoachInput } from "../budgets/budgetCoach";
import { buildGeminiBudgetSetupPayload, normalizeGeminiBudgetSetupReport } from "./geminiBudgetSetup";

describe("Gemini budget setup domain", () => {
  it("builds a redacted setup payload from onboarding budget inputs", () => {
    const snapshot = createDemoSnapshot();
    snapshot.accounts[0] = {
      ...snapshot.accounts[0],
      name: "Personal account 1234567890",
      institutionLabel: "Bank user@example.com"
    };
    const input = budgetInput(snapshot);

    const payload = buildGeminiBudgetSetupPayload(snapshot, input, demoAsOfDate);

    expect(payload.currency).toBe("MYR");
    expect(payload.privacy.apiKeyStoredByBluehour).toBe(false);
    expect(payload.setup.salaryMinor).toBe(780_000);
    expect(payload.accounts[0].label).toBe("Personal account [redacted-number]");
    expect(payload.knownCommitments[0].amountMinor).toBe(220_000);
    expect(payload.essentialPreferences.length).toBeGreaterThan(0);
  });

  it("normalizes setup output and ignores non-envelope categories", () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiBudgetSetupPayload(snapshot, budgetInput(snapshot), demoAsOfDate);

    const report = normalizeGeminiBudgetSetupReport(
      {
        reportTitle: "First budget",
        executiveSummary: "A careful first cycle.",
        firstCycleBudget: [
          {
            categoryId: "cat-groceries",
            categoryName: "Groceries",
            amountMinor: 90_000,
            priority: "essential",
            confidence: "medium",
            rationale: "Start with a realistic grocery envelope.",
            warnings: []
          },
          {
            categoryId: "cat-housing",
            categoryName: "Housing",
            amountMinor: 220_000,
            priority: "essential",
            confidence: "high",
            rationale: "Housing is planned separately and should not be an envelope template item.",
            warnings: []
          }
        ],
        riskFlags: [],
        actionPlan: ["Review after the first salary clears."],
        disclaimer: "Educational budgeting guidance only."
      },
      payload.categories
    );

    expect(report.firstCycleBudget).toHaveLength(1);
    expect(report.firstCycleBudget[0]).toMatchObject({ categoryId: "cat-groceries", amountMinor: 90_000 });
    expect(report.riskFlags[0]).toContain("1 first-cycle budget item");
  });

  it("rejects non-integer budget amounts", () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiBudgetSetupPayload(snapshot, budgetInput(snapshot), demoAsOfDate);

    expect(() =>
      normalizeGeminiBudgetSetupReport(
        {
          reportTitle: "First budget",
          executiveSummary: "Summary",
          firstCycleBudget: [
            {
              categoryId: "cat-groceries",
              categoryName: "Groceries",
              amountMinor: 90_000.5,
              priority: "essential",
              confidence: "medium",
              rationale: "Invalid float.",
              warnings: []
            }
          ],
          riskFlags: [],
          actionPlan: [],
          disclaimer: "Educational budgeting guidance only."
        },
        payload.categories
      )
    ).toThrow();
  });
});

function budgetInput(snapshot: ReturnType<typeof createDemoSnapshot>): BudgetCoachInput {
  const preferences = defaultBudgetCoachPreferences(snapshot.categories);
  return {
    salaryMinor: 780_000,
    cycleStartDate: "2026-07-24",
    cycleEndDate: "2026-08-23",
    profileId: "balanced",
    configuredMinimumProtectedRateBasisPoints: 1_000,
    bufferMinimumMinor: 50_000,
    bufferEssentialRateBasisPoints: 1_000,
    commitments: [
      {
        id: "plan-rent",
        label: "Rent account 1234567890",
        amountMinor: 220_000,
        categoryId: "cat-housing",
        dueDate: "2026-07-25",
        source: "plan"
      }
    ],
    essentialPreferences: preferences.essentialPreferences,
    discretionaryPreferences: preferences.discretionaryPreferences
  };
}
