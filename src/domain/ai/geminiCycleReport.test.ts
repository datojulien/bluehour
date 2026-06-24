import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import { buildGeminiCycleReportPayload, normalizeGeminiCycleReport } from "./geminiCycleReport";

describe("Gemini cycle report domain", () => {
  it("builds a redacted cycle payload with integer-sen facts", () => {
    const snapshot = createDemoSnapshot();
    snapshot.transactions = snapshot.transactions.map((transaction) =>
      transaction.id === "txn-shopping"
        ? {
            ...transaction,
            description: "Northstar Supplies card 4111 1111 1111 1111",
            merchantNormalized: "northstar account 1234567890",
            note: "Receipt sent to user@example.com"
          }
        : transaction
    );

    const payload = buildGeminiCycleReportPayload(snapshot, snapshot.budgetCycles[0], demoAsOfDate);
    const transaction = payload.transactions.find((item) => item.id === "txn-shopping");

    expect(payload.currency).toBe("MYR");
    expect(payload.privacy.apiKeyStoredByBluehour).toBe(false);
    expect(payload.transactions.length).toBeGreaterThan(0);
    expect(transaction?.description).toContain("[redacted-number]");
    expect(transaction?.merchantNormalized).toBe("northstar account [redacted-number]");
    expect(transaction?.note).toBe("Receipt sent to [redacted-email]");
    expect(Number.isInteger(payload.budgetProgress[0].spentMinor)).toBe(true);
  });

  it("normalizes a structured report and ignores non-applicable budget categories", () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiCycleReportPayload(snapshot, snapshot.budgetCycles[0], demoAsOfDate);

    const report = normalizeGeminiCycleReport(
      {
        reportTitle: "Cycle review",
        executiveSummary: "Dining ran warm, but savings stayed protected.",
        currentCycleAnalysis: ["Dining out is above pace."],
        savingAdvice: [
          {
            title: "Trim weekday lunches",
            categoryId: "cat-dining",
            rationale: "Several small meals added up.",
            estimatedSavingMinor: 12_000
          }
        ],
        spendPriorities: [
          {
            title: "Keep groceries comfortable",
            categoryId: "cat-groceries",
            rationale: "Groceries are essential.",
            suggestedAmountMinor: 90_000
          }
        ],
        reductions: [
          {
            categoryId: "cat-dining",
            categoryName: "Dining Out",
            currentCycleSpentMinor: 51_000,
            recommendedNextCycleMinor: 55_000,
            rationale: "Reduce without cutting it to zero."
          }
        ],
        nextCycleBudget: [
          {
            categoryId: "cat-dining",
            categoryName: "Dining Out",
            amountMinor: 55_000,
            priority: "reduce",
            confidence: "medium",
            rationale: "Bring dining back under control.",
            warnings: []
          },
          {
            categoryId: "cat-savings",
            categoryName: "Savings",
            amountMinor: 80_000,
            priority: "protect",
            confidence: "high",
            rationale: "Protected categories are not allocation targets here.",
            warnings: []
          },
          {
            categoryId: "cat-missing",
            categoryName: "Missing",
            amountMinor: 1_000,
            priority: "flex",
            confidence: "low",
            rationale: "Unknown.",
            warnings: []
          }
        ],
        riskFlags: [],
        actionPlan: ["Approve a budget only after checking fixed bills."],
        disclaimer: "Educational budgeting guidance only."
      },
      payload.categories
    );

    expect(report.nextCycleBudget).toHaveLength(1);
    expect(report.nextCycleBudget[0]).toMatchObject({ categoryId: "cat-dining", categoryName: "Dining Out", amountMinor: 55_000 });
    expect(report.riskFlags[0]).toContain("2 next-cycle budget items");
  });

  it("rejects non-integer money in Gemini output", () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiCycleReportPayload(snapshot, snapshot.budgetCycles[0], demoAsOfDate);

    expect(() =>
      normalizeGeminiCycleReport(
        {
          reportTitle: "Cycle review",
          executiveSummary: "Summary",
          currentCycleAnalysis: [],
          savingAdvice: [],
          spendPriorities: [],
          reductions: [],
          nextCycleBudget: [
            {
              categoryId: "cat-dining",
              categoryName: "Dining Out",
              amountMinor: 55_000.5,
              priority: "reduce",
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
