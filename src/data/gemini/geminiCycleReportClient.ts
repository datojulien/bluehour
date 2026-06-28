import {
  GEMINI_CYCLE_REPORT_RESPONSE_SCHEMA,
  buildGeminiCycleReportPrompt,
  normalizeGeminiCycleReport,
  type GeminiCycleReport,
  type GeminiCycleReportPayload
} from "../../domain/ai/geminiCycleReport";

export const DEFAULT_GEMINI_CYCLE_REPORT_MODEL = "gemini-3.1-pro-preview";
const GEMINI_INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

type Fetcher = typeof fetch;

export interface GeminiInteractionResponse {
  output_text?: string;
  status?: string;
  error?: {
    message?: string;
  };
  steps?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface GeminiErrorResponse {
  error?: {
    message?: string;
    status?: string;
  };
}

export async function generateGeminiCycleReport({
  apiKey,
  model = DEFAULT_GEMINI_CYCLE_REPORT_MODEL,
  payload,
  fetcher = fetch
}: {
  apiKey: string;
  model?: string;
  payload: GeminiCycleReportPayload;
  fetcher?: Fetcher;
}): Promise<GeminiCycleReport> {
  const trimmedApiKey = apiKey.trim();
  const trimmedModel = model.trim();
  if (!trimmedApiKey) {
    throw new Error("Enter a Gemini API key for this one-time report.");
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
      input: buildGeminiCycleReportPrompt(payload),
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: GEMINI_CYCLE_REPORT_RESPONSE_SCHEMA
      },
      generation_config: {
        thinking_level: "high"
      }
    })
  });

  const body = await parseJsonBody(response);
  if (!response.ok) {
    const errorBody = body as GeminiErrorResponse;
    throw new Error(errorBody.error?.message ?? `Gemini report request failed with HTTP ${response.status}`);
  }

  const text = extractGeminiOutputText(body as GeminiInteractionResponse);
  const parsed = parseJsonText(text);
  return normalizeGeminiCycleReport(parsed, payload.categories);
}

export function extractGeminiOutputText(response: GeminiInteractionResponse, emptyMessage = "Gemini returned no report text.", outputLabel = "report"): string {
  if (response.status && response.status !== "completed") {
    throw new Error(geminiStatusMessage(response, outputLabel));
  }

  const direct = response.output_text?.trim();
  if (direct) {
    return direct;
  }

  const stepText = response.steps
    ?.slice()
    .reverse()
    .find((step) => step.type === "model_output")
    ?.content?.map((content) => (content.type === "text" ? content.text ?? "" : ""))
    .join("")
    .trim();
  if (stepText) {
    return stepText;
  }

  const candidateText = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (candidateText) {
    return candidateText;
  }

  throw new Error(emptyMessage);
}

function geminiStatusMessage(response: GeminiInteractionResponse, outputLabel: string): string {
  const detail = response.error?.message ? ` ${response.error.message}` : "";
  switch (response.status) {
    case "in_progress":
      return `Gemini is still generating the ${outputLabel}. Try again in a moment.`;
    case "requires_action":
      return `Gemini requested an unsupported follow-up action instead of returning a ${outputLabel}.`;
    case "failed":
      return `Gemini ${outputLabel} generation failed.${detail}`;
    case "cancelled":
      return `Gemini ${outputLabel} generation was cancelled.`;
    case "incomplete":
      return `Gemini returned an incomplete ${outputLabel}, likely because the response limit was reached.`;
    case "budget_exceeded":
      return `Gemini stopped before returning a ${outputLabel} because the token budget was exceeded.`;
    default:
      return `Gemini ${outputLabel} generation did not complete (status: ${response.status}).${detail}`;
  }
}

function parseJsonText(text: string): unknown {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new Error("Gemini returned a report that was not valid JSON.");
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
