import { describe, expect, it } from "vitest";
import { createDemoSnapshot, demoAsOfDate } from "../../test/fixtures/demoData";
import { buildGeminiCycleReportPayload } from "../../domain/ai/geminiCycleReport";
import { generateGeminiCycleReport } from "./geminiCycleReportClient";

describe("Gemini cycle report client", () => {
  it("calls the Interactions API with structured JSON output settings", async () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiCycleReportPayload(snapshot, snapshot.budgetCycles[0], demoAsOfDate);
    const calls: Array<Parameters<typeof fetch>> = [];
    const fetcher: typeof fetch = async (...args) => {
      calls.push(args);
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify(validGeminiReport())
        }),
        { status: 200 }
      );
    };

    const report = await generateGeminiCycleReport({
      apiKey: "test-key",
      model: "gemini-test-pro",
      payload,
      fetcher
    });

    expect(report.nextCycleBudget[0].categoryId).toBe("cat-dining");
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
      response_format: { mime_type: string };
      generation_config: { thinking_level: string };
    };
    expect(requestBody.model).toBe("gemini-test-pro");
    expect(requestBody.input).toContain("Bluehour payload");
    expect(requestBody.response_format.mime_type).toBe("application/json");
    expect(requestBody.generation_config.thinking_level).toBe("high");
  });

  it("surfaces Gemini API errors", async () => {
    const snapshot = createDemoSnapshot();
    const payload = buildGeminiCycleReportPayload(snapshot, snapshot.budgetCycles[0], demoAsOfDate);
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "API key rejected" } }), { status: 400 });

    await expect(generateGeminiCycleReport({ apiKey: "bad-key", payload, fetcher })).rejects.toThrow("API key rejected");
  });
});

function validGeminiReport() {
  return {
    reportTitle: "Cycle review",
    executiveSummary: "Dining ran warm, but core bills are covered.",
    currentCycleAnalysis: ["Dining is above its intended pace."],
    savingAdvice: [],
    spendPriorities: [],
    reductions: [],
    nextCycleBudget: [
      {
        categoryId: "cat-dining",
        categoryName: "Dining Out",
        amountMinor: 55_000,
        priority: "reduce",
        confidence: "medium",
        rationale: "Keep social spending but set a tighter ceiling.",
        warnings: []
      }
    ],
    riskFlags: [],
    actionPlan: ["Check fixed plans before accepting."],
    disclaimer: "Educational budgeting guidance only."
  };
}
