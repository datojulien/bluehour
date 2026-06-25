import {
  GEMINI_BUDGET_SETUP_RESPONSE_SCHEMA,
  buildGeminiBudgetSetupPrompt,
  normalizeGeminiBudgetSetupReport,
  type GeminiBudgetSetupPayload,
  type GeminiBudgetSetupReport
} from "../../domain/ai/geminiBudgetSetup";
import { DEFAULT_GEMINI_CYCLE_REPORT_MODEL, extractGeminiOutputText, type GeminiInteractionResponse } from "./geminiCycleReportClient";

const GEMINI_INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

type Fetcher = typeof fetch;

interface GeminiErrorResponse {
  error?: {
    message?: string;
    status?: string;
  };
}

export async function generateGeminiBudgetSetup({
  apiKey,
  model = DEFAULT_GEMINI_CYCLE_REPORT_MODEL,
  payload,
  fetcher = fetch
}: {
  apiKey: string;
  model?: string;
  payload: GeminiBudgetSetupPayload;
  fetcher?: Fetcher;
}): Promise<GeminiBudgetSetupReport> {
  const trimmedApiKey = apiKey.trim();
  const trimmedModel = model.trim();
  if (!trimmedApiKey) {
    throw new Error("Enter a Gemini API key for this one-time setup helper.");
  }
  if (!trimmedModel) {
    throw new Error("Choose a Gemini model.");
  }

  const response = await fetcher(GEMINI_INTERACTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": trimmedApiKey
    },
    body: JSON.stringify({
      model: trimmedModel,
      input: buildGeminiBudgetSetupPrompt(payload),
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: GEMINI_BUDGET_SETUP_RESPONSE_SCHEMA
      },
      generation_config: {
        thinking_level: "high"
      }
    })
  });

  const body = await parseJsonBody(response);
  if (!response.ok) {
    const errorBody = body as GeminiErrorResponse;
    throw new Error(errorBody.error?.message ?? `Gemini setup request failed with HTTP ${response.status}`);
  }

  const text = extractGeminiOutputText(body as GeminiInteractionResponse);
  const parsed = parseJsonText(text);
  return normalizeGeminiBudgetSetupReport(parsed, payload.categories);
}

function parseJsonText(text: string): unknown {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new Error("Gemini returned a setup response that was not valid JSON.");
  }
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text } };
  }
}
