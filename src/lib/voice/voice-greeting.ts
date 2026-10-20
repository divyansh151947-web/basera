/**
 * Shared voice greeting + language-switch primitives.
 *
 * Deliberately free of "server-only" so BOTH the browser widget and the
 * server routes import the identical greeting text and switch phrases —
 * the greeting can never drift between client display and stored transcript.
 */

export const VOICE_GREETING_TEXT = "Hello, how are you? What can I help you with?";

/** Metadata marker identifying the persisted greeting message (idempotency). */
export const VOICE_GREETING_MARKER = "voiceGreeting";

export type GreetingSwitchLanguage = "hi" | "en";

/**
 * Detects an EXPLICIT user language switch ("Hindi mein baat karo",
 * "Speak in English", ...). Returns the requested language or null when the
 * text states no clear preference. Pure, deterministic, Hindi/English +
 * roman + Devanagari; regional languages are NOT claimed (null).
 */
export function detectLanguageSwitch(text: string): GreetingSwitchLanguage | null {
  const normalized = (text ?? "").toLowerCase();
  if (!normalized.trim()) return null;
  const hindiPatterns = [
    /hindi\s+mein\s+(baat\s+karo|bolo|baat\s+kijiye|boliye)\b/,
    /hindi\s+mein\b/,
    /हिंदी\s+में/,
    /हिन्दी\s+में/,
  ];
  const englishPatterns = [
    /speak\s+in\s+english\b/,
    /talk\s+in\s+english\b/,
    /english\s+mein\s+(baat\s+karo|bolo|baat\s+kijiye|boliye)\b/,
    /english\s+mein\b/,
  ];
  if (hindiPatterns.some((re) => re.test(normalized))) return "hi";
  if (englishPatterns.some((re) => re.test(normalized))) return "en";
  return null;
}
