import "server-only";
import { fetchWithTimeout, providerTimeoutMs } from "./fetch-timeout";

/**
 * Thin wrapper around the OpenAI Chat Completions API.
 * Server-side only — OPENAI_API_KEY is never imported by client code.
 * Mirrors lib/ai/claude-client.ts so the rest of the pipeline can switch
 * providers without changing call sites (see lib/ai/ai-provider.ts).
 */

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export function openAIIsConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function callOpenAI(params: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!openAIIsConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured. AI agent features are disabled until this is set.");
  }

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: params.maxTokens ?? 800,
        temperature: 0.4,
        messages: [{ role: "system", content: params.system }, ...params.messages],
      }),
    },
    providerTimeoutMs()
  ).catch((err) => {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("OpenAI request timed out. Please try again.");
    }
    throw err;
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content ?? "").trim();

  return {
    text,
    usage: data.usage
      ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
      : undefined,
  };
}
