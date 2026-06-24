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

interface GeminiInteractionResponse {
  output_text?: string;
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

export function extractGeminiOutputText(response: GeminiInteractionResponse): string {
  const direct = response.output_text?.trim();
  if (direct) {
    return direct;
  }

  const candidateText = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (candidateText) {
    return candidateText;
  }

  throw new Error("Gemini returned no report text.");
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
