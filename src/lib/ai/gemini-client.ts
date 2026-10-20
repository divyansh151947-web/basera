import "server-only";

/**
 * GEMINI AI CLIENT for conversational brain.
 *
 * Uses the existing GEMINI_API_KEY (already configured for voice).
 * Provides a compatible interface for the AI provider abstraction.
 *
 * Includes per-model quota fallback: free tier caps requests PER MODEL per day
 * (~20/day on flash aliases). When the primary model is exhausted (429
 * RESOURCE_EXHAUSTED), we try same-vendor fallbacks instead of failing the
 * entire conversation.
 */

type GeminiRole = "user" | "model";

interface GeminiGenerateContentRequest {
  contents: Array<{
    role: GeminiRole;
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>;
    };
    finishReason?: string;
  }>;
  error?: { message?: unknown; code?: number };
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Gemini AI is not configured. Set GEMINI_API_KEY.");
  return key;
}

export function geminiAiIsConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function primaryChatModel(): string {
  return process.env.GEMINI_CHAT_MODEL?.trim() || "gemini-3.8-flash";
}

const DEFAULT_CHAT_FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"];

function resolveChatModelChain(): string[] {
  const raw = process.env.GEMINI_CHAT_FALLBACK_MODELS;
  const extras = raw === undefined ? DEFAULT_CHAT_FALLBACK_MODELS : raw.split(",").map((m) => m.trim()).filter(Boolean);
  return Array.from(new Set([primaryChatModel(), ...extras]));
}

function turnTimeoutMs(): number {
  const raw = Number(process.env.AI_TURN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 3_000 && raw <= 120_000 ? raw : 8_000;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const timeout = new Error("Gemini AI request timed out.");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function toError(status: number | null, body?: unknown): Error {
  if (status === 401 || status === 403) return new Error("Gemini AI is not authorized. Check the server AI configuration.");
  if (status === 429) {
    const msg = body && typeof body === "object" && "error" in body
      ? String((body as { error?: { message?: unknown } }).error?.message || "")
      : "";
    if (/quota|resource\.exhausted|exhausted/i.test(msg)) {
      return new Error("Gemini AI quota exhausted. Please try again later.");
    }
    return new Error("Gemini AI is rate-limited right now. Please try again shortly.");
  }
  if (status === 408 || status === null) return new Error("Gemini AI timed out. Please try again.");
  if (status !== null && status >= 500) {
    return new Error("Gemini AI failed temporarily. Please try again shortly.");
  }
  if (status === 400 || status === 422) {
    return new Error("Gemini AI request was rejected. Please try again.");
  }
  return new Error("Gemini AI failed. Please try again.");
}

function isRetryableError(status: number | null, body?: unknown): boolean {
  // Retry on quota exhaustion (429 with quota message)
  if (status === 429) {
    const msg = body && typeof body === "object" && "error" in body
      ? String((body as { error?: { message?: unknown } }).error?.message || "")
      : "";
    if (/quota|resource\.exhausted|exhausted/i.test(msg)) {
      return true;
    }
  }
  // Retry on temporary server errors (503, 504, etc.)
  if (status !== null && status >= 500 && status < 600) {
    return true;
  }
  return false;
}

export interface GeminiCallParams {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
}

export interface GeminiCallResult {
  text: string;
}

export async function callGemini(params: GeminiCallParams): Promise<GeminiCallResult> {
  const key = apiKey();
  const models = resolveChatModelChain();
  const contents: Array<{ role: GeminiRole; parts: Array<{ text: string }> }> = params.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const bodyBase: Omit<GeminiGenerateContentRequest, "contents"> = {
    systemInstruction: { parts: [{ text: params.system }] },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: params.maxTokens ?? 2048,
    },
  };

  let lastError: Error | null = null;
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body: GeminiGenerateContentRequest = { ...bodyBase, contents };
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "x-goog-api-key": key, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        turnTimeoutMs()
      );
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        lastError = toError(null);
        continue;
      }
      lastError = new Error("Gemini AI request failed. Please try again.");
      continue;
    }

    let resBody: unknown = null;
    if (!res.ok) {
      resBody = await res.json().catch(() => null);
      const err = toError(res.status, resBody);
      // Retry on quota exhaustion or temporary server errors (5xx).
      if (isRetryableError(res.status, resBody)) {
        console.warn("[gemini-client] Model error, trying fallback", { model, status: res.status, nextModel: models[models.indexOf(model) + 1] });
        lastError = err;
        continue;
      }
      throw err;
    }

    const data = (await res.json().catch(() => null)) as GeminiGenerateContentResponse | null;
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => typeof p.text === "string" ? p.text : "").join("").trim() ?? "";
    if (!text) throw new Error("Gemini AI produced no response. Please try again.");
    if (model !== models[0]) {
      console.info("[gemini-client] Fallback model succeeded", { model });
    }
    return { text };
  }
  throw lastError ?? new Error("Gemini AI failed. Please try again.");
}