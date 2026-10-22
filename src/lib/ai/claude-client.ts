import "server-only";
import { fetchWithTimeout, providerTimeoutMs } from "./fetch-timeout";

/**
 * Thin wrapper around the Anthropic Messages API. Centralizing this:
 *  - makes model selection / cost tuning a one-line change (see MODEL below)
 *  - lets us track usage (see recordAIUsage call sites in the agent modules)
 *  - is the single point where the ANTHROPIC_API_KEY env var is read, so it
 *    never leaks into client bundles or logs.
 *
 * If ANTHROPIC_API_KEY is not configured, callers fall back to deterministic
 * rule-based logic (see lib/ai/*.ts) so the product still functions in demo
 * mode without a live key — this is called out explicitly, not silently
 * mocked, per the project's "no fake functionality" requirement.
 */

// Model override via env (mirrors OPENAI_MODEL / GEMINI_CHAT_MODEL) so a
// stale/renamed Anthropic model can be fixed in deployment config without a
// code change. Default keeps the currently-shipping model.
const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

export function aiIsConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function callClaude(params: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!aiIsConfigured()) {
    throw new Error("ANTHROPIC_API_KEY is not configured. AI agent features are disabled until this is set.");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: params.maxTokens ?? 800,
      system: params.system,
      messages: params.messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  return {
    text,
    usage: data.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : undefined,
  };
}
