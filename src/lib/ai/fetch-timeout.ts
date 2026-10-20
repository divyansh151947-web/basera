import "server-only";

/**
 * Shared provider-call timeout for the text-generation clients.
 *
 * Same policy as the Gemini client: AI_TURN_TIMEOUT_MS clamped to
 * 3s–120s, defaulting to 8s. A hung provider must fail the turn (callers
 * already catch provider errors into deterministic fallbacks) rather than
 * block it indefinitely. Timeout surfaces as a TimeoutError with a generic,
 * user-safe message — never provider internals or credentials.
 */
export function providerTimeoutMs(): number {
  const raw = Number(process.env.AI_TURN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 3_000 && raw <= 120_000 ? raw : 8_000;
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const timeout = new Error("Provider request timed out.");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
