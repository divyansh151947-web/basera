import "server-only";
import { callClaude, aiIsConfigured as claudeIsConfigured } from "./claude-client";
import { callOpenAI, openAIIsConfigured } from "./openai-client";
import { callGemini, geminiAiIsConfigured } from "./gemini-client";

/**
 * Unified AI provider for Basera.
 * - Prefers OpenAI when OPENAI_API_KEY is set.
 * - Falls back to Anthropic when only ANTHROPIC_API_KEY is set.
 * - Falls back to Gemini when only GEMINI_API_KEY is set (free tier).
 * - Throws when none are configured; callers use deterministic
 *   rule-based fallbacks (offline/demo mode) in that case.
 *
 * Keeps the existing pipeline (qualification -> matching -> scoring ->
 * handoff) unchanged; only the LLM transport is abstracted.
 */

export type AIMessage = { role: "user" | "assistant"; content: string };

export function aiIsConfigured() {
  return openAIIsConfigured() || claudeIsConfigured() || geminiAiIsConfigured();
}

export function activeAIProvider(): "openai" | "anthropic" | "gemini" | "none" {
  if (openAIIsConfigured()) return "openai";
  if (claudeIsConfigured()) return "anthropic";
  if (geminiAiIsConfigured()) return "gemini";
  return "none";
}

export async function callAI(params: { system: string; messages: AIMessage[]; maxTokens?: number }) {
  if (openAIIsConfigured()) return callOpenAI(params);
  if (claudeIsConfigured()) return callClaude(params);
  return callGemini(params);
}
