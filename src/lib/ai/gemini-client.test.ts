import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { callGemini, geminiAiIsConfigured } from "./gemini-client";

const SAVED_KEY = process.env.GEMINI_API_KEY;
const SAVED_MODEL = process.env.GEMINI_CHAT_MODEL;
const SAVED_FALLBACKS = process.env.GEMINI_CHAT_FALLBACK_MODELS;

type Handler = (model: string) => Response;

let calls: string[] = [];
let handler: Handler | null = null;

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function ok(text: string): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: { code: status, message } }, status);
}

function modelFromUrl(url: string): string {
  const m = /\/models\/([^/:]+):generateContent/.exec(url);
  return m ? decodeURIComponent(m[1]) : "";
}

beforeEach(() => {
  calls = [];
  handler = null;
  setEnv("GEMINI_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const model = modelFromUrl(String(url));
      calls.push(model);
      if (!handler) throw new Error("No mock handler set.");
      return handler(model);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setEnv("GEMINI_API_KEY", SAVED_KEY);
  setEnv("GEMINI_CHAT_MODEL", SAVED_MODEL);
  setEnv("GEMINI_CHAT_FALLBACK_MODELS", SAVED_FALLBACKS);
});

describe("callGemini model chain (mocked transport — key never leaves test)", () => {
  it("fails closed without a key and never hits the network", async () => {
    setEnv("GEMINI_API_KEY", undefined);
    expect(geminiAiIsConfigured()).toBe(false);
    await expect(callGemini({ system: "s", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/not configured/i);
    expect(calls).toEqual([]);
  });

  it("walks past a 404 retired model instead of aborting the chain", async () => {
    setEnv("GEMINI_CHAT_MODEL", "gemini-3.8-flash");
    setEnv("GEMINI_CHAT_FALLBACK_MODELS", "gemini-1.5-flash,gemini-3.5-flash-lite");
    handler = (model) => {
      if (model === "gemini-3.8-flash") return errorResponse(429, "Quota exceeded for metric: generate_content_free_tier_requests");
      if (model === "gemini-1.5-flash") return errorResponse(404, "models/gemini-1.5-flash is not found for API version v1beta");
      return ok("fallback answer");
    };
    const result = await callGemini({ system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("fallback answer");
    expect(calls).toEqual(["gemini-3.8-flash", "gemini-1.5-flash", "gemini-3.5-flash-lite"]);
  });

  it("does not use retired models in its default chain", async () => {
    setEnv("GEMINI_CHAT_MODEL", "gemini-3.8-flash");
    setEnv("GEMINI_CHAT_FALLBACK_MODELS", undefined);
    handler = () => ok("ok");
    await callGemini({ system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(calls).toEqual(["gemini-3.8-flash"]);
    // The default chain is only observable through failures, so force the
    // primary to fail open (503) and let the remaining defaults answer.
    calls = [];
    handler = (model) => (model === "gemini-3.8-flash" ? errorResponse(503, "This model is currently experiencing high demand.") : ok("chain"));
    const result = await callGemini({ system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("chain");
    expect(calls[0]).toBe("gemini-3.8-flash");
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.join(",")).not.toMatch(/gemini-1\.5-flash|gemini-2\.5-flash/);
  });

  it("falls through when a healthy model returns an empty response", async () => {
    setEnv("GEMINI_CHAT_MODEL", "gemini-3.8-flash");
    setEnv("GEMINI_CHAT_FALLBACK_MODELS", "gemini-3.5-flash-lite");
    handler = (model) => (model === "gemini-3.8-flash" ? ok("") : ok("second model answered"));
    const result = await callGemini({ system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("second model answered");
    expect(calls).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });

  it("throws a user-safe error once every model in the chain fails", async () => {
    setEnv("GEMINI_CHAT_MODEL", "gemini-3.8-flash");
    setEnv("GEMINI_CHAT_FALLBACK_MODELS", "gemini-3.5-flash");
    handler = (model) =>
      model === "gemini-3.8-flash"
        ? errorResponse(503, "This model is currently experiencing high demand.")
        : errorResponse(429, "Quota exceeded for metric: generate_content_free_tier_requests");
    await expect(callGemini({ system: "s", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /quota exhausted|rate-limited|failed/i
    );
    expect(calls).toEqual(["gemini-3.8-flash", "gemini-3.5-flash"]);
  });

  it("honors an operator-provided GEMINI_CHAT_FALLBACK_MODELS override", async () => {
    setEnv("GEMINI_CHAT_MODEL", "gemini-3.8-flash");
    setEnv("GEMINI_CHAT_FALLBACK_MODELS", "gemini-3.6-flash");
    handler = (model) => (model === "gemini-3.8-flash" ? errorResponse(503, "high demand") : ok("custom chain"));
    const result = await callGemini({ system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("custom chain");
    expect(calls).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"]);
  });
});
