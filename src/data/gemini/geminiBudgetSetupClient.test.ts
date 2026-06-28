import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import { defaultBudgetCoachPreferences, type BudgetCoachInput } from "../../domain/budgets/budgetCoach";
import { buildGeminiBudgetSetupPayload } from "../../domain/ai/geminiBudgetSetup";
import { generateGeminiBudgetSetup } from "./geminiBudgetSetupClient";

describe("Gemini budget setup client", () => {
  it("calls Gemini with setup prompt and structured JSON settings", async () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiBudgetSetupPayload(snapshot, budgetInput(snapshot), demoAsOfDate);
    const calls: Array<Parameters<typeof fetch>> = [];
    const fetcher: typeof fetch = async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ output_text: JSON.stringify(validSetupReport()) }), { status: 200 });
    };

    const report = await generateGeminiBudgetSetup({
      apiKey: "test-key",
      model: "gemini-test-pro",
      payload,
      fetcher
    });

    expect(report.firstCycleBudget[0].categoryId).toBe("cat-groceries");
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": "test-key"
    });
    const requestBody = JSON.parse(init?.body as string) as {
      model: string;
      input: string;
      store: boolean;
      response_format: { mime_type: string };
      generation_config: { thinking_level: string };
    };
    expect(requestBody.model).toBe("gemini-test-pro");
    expect(requestBody.input).toContain("first salary-cycle budget setup assistant");
    expect(requestBody.store).toBe(false);
    expect(requestBody.response_format.mime_type).toBe("application/json");
    expect(requestBody.generation_config.thinking_level).toBe("high");
  });

  it("parses setup proposal text from Interactions API model output steps", async () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiBudgetSetupPayload(snapshot, budgetInput(snapshot), demoAsOfDate);
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: JSON.stringify(validSetupReport()) }]
            }
          ]
        }),
        { status: 200 }
      );

    const report = await generateGeminiBudgetSetup({ apiKey: "test-key", payload, fetcher });

    expect(report.reportTitle).toBe("First budget");
    expect(report.firstCycleBudget[0].categoryId).toBe("cat-groceries");
  });

  it("surfaces setup API errors", async () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiBudgetSetupPayload(snapshot, budgetInput(snapshot), demoAsOfDate);
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "API key rejected" } }), { status: 400 });

    await expect(generateGeminiBudgetSetup({ apiKey: "bad-key", payload, fetcher })).rejects.toThrow("API key rejected");
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
    commitments: [],
    essentialPreferences: preferences.essentialPreferences,
    discretionaryPreferences: preferences.discretionaryPreferences
  };
}

function validSetupReport() {
  return {
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
      }
    ],
    riskFlags: [],
    actionPlan: ["Review after the first salary clears."],
    disclaimer: "Educational budgeting guidance only."
  };
}
