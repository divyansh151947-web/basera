import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..", "..");
const read = (rel: string) => readFileSync(resolve(srcRoot, rel), "utf8");

/**
 * Voice AI discoverability (dashboard + public website).
 *
 * The task adds entries only; these tests lock the contract: the dashboard
 * entry reuses the identical sidebar NAV pattern, and the public entry
 * reuses the existing voice widget/backend (no second voice system, no
 * redesign, no secret exposure).
 */
describe("voice AI discoverability", () => {
  it("dashboard sidebar lists Voice AI immediately after Conversations, same pattern", () => {
    const sidebar = read("components/sidebar.tsx");
    const conversationsEnd = sidebar.indexOf('icon: MessageSquare');
    const voiceIdx = sidebar.indexOf('label: "Voice AI"');
    expect(conversationsEnd).toBeGreaterThan(-1);
    expect(voiceIdx).toBeGreaterThan(conversationsEnd);
    // Adjacent: exactly one NAV href between them — the voice entry itself.
    const between = sidebar.slice(conversationsEnd, voiceIdx);
    expect(between.match(/href: "/g)).toHaveLength(1);
    expect(between).toContain('href: "/voice"');
    expect(sidebar).toMatch(/href: "\/voice", label: "Voice AI", icon: Mic/);
    // Identical treatment: shared NAV map, shared active-state classes.
    expect(sidebar).toMatch(/pathname\?\.startsWith\(item\.href\)/);
    // No bespoke styling, no permission fork for the entry.
    const voiceBlock = sidebar.slice(voiceIdx, voiceIdx + 400);
    expect(voiceBlock).not.toMatch(/className/);
  });

  it("public landing mounts the voice entry next to the unchanged chat entry", () => {
    const page = read("app/page.tsx");
    expect(page).toMatch(/<PublicChatWidget \/>/);
    const chatIdx = page.indexOf("<PublicChatWidget />");
    // The button receives the resolved public org slug (server-side) so the
    // voice panel starts on the actual deployed workspace; it is still the
    // immediate neighbor of the chat entry near the end of the page.
    const voiceIdx = page.indexOf("<PublicVoiceButton");
    expect(voiceIdx).toBeGreaterThan(-1);
    expect(Math.abs(voiceIdx - chatIdx)).toBeLessThan(600);
  });

  it("public voice entry reuses the existing widget/backend (no second system)", () => {
    const button = read("components/public-voice-button.tsx");
    expect(button).toMatch(/VoiceSessionWidget/);
    // The wrapper makes NO backend calls of its own: all session/turn API
    // traffic stays inside the reused widget (same tenant model, same limits).
    expect(button).not.toMatch(/fetch\(|\/api\//);
    // Same floating-bubble + popover treatment as the chat entry. The two
    // launchers are now STACKED (voice floats above chat in one right-aligned
    // column) and coordinate open/close through window events, so the safe-area
    // offsets moved into inline styles; this still locks: fixed positioning,
    // the shared brand bubble, and the same popover rail (right-4 / max-w-430).
    expect(button).toMatch(/fixed right-5 z-50[\s\S]*rounded-full bg-brand/);
    expect(button).toMatch(/fixed right-4 z-50[\s\S]*max-w-\[430px\]/);
    expect(button).toMatch(/safe-area-inset-bottom/);
    // Still no secrets in the launcher itself; the org slug arrives as a prop.
    expect(button).not.toMatch(/API_KEY|SECRET|TOKEN|NEXT_PUBLIC_/);
  });

  it("existing public chatbot is untouched by the voice entry", () => {
    const widget = read("components/public-chat-widget.tsx");
    // The chatbot grows no voice system of its own: no voice API routes, no
    // mic/recording/speech surfaces. It MAY coordinate open/close with the
    // floating voice launcher (they share the bottom-right slot), which is
    // why a plain /voice/i ban no longer applies — only the functional
    // surfaces are forbidden.
    expect(widget).not.toMatch(/\/api\/voice|MediaRecorder|getUserMedia|speechSynthesis/i);
    expect(widget).not.toMatch(/\bMic\b|microphone/i);
    expect(widget).toMatch(/\/api\/public\/chat/);
  });

  it("voice panel has no manual Speak/Dictate/record controls (automatic loop)", () => {
    const raw = read("components/voice-session-widget.tsx");
    // Strip comments: the requirement covers rendered controls, and the
    // header comment legitimately documents their absence.
    const widget = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // No manual speech actions may exist: no Dictate toggle, no manual
    // record/stop or speaker/play buttons (function names like
    // speakTextFallback are implementation, not controls).
    expect(widget).not.toMatch(/>Dictate</);
    expect(widget).not.toMatch(/Start listening|Stop listening/);
    expect(widget).not.toMatch(/Record voice message|Stop recording and send/);
    expect(widget).not.toMatch(/>Speak</);
    expect(widget).not.toMatch(/webkitSpeechRecognition|SpeechRecognition/);
    // The automatic loop is driven by the shared controller instead.
    expect(widget).toMatch(/VoiceLoopController/);
    expect(widget).toMatch(/Listening/);
    expect(widget).toMatch(/Playing AI reply/);
  });

  it("voice start is guarded, capability-checked, and greeting-wired", () => {
    const widget = read("components/voice-session-widget.tsx");
    // Synchronous duplicate-start guard (double-click safe).
    expect(widget).toMatch(/startingRef/);
    // Unsupported-browser pre-check before any getUserMedia call.
    expect(widget).toMatch(/mediaDevices\?\.getUserMedia/);
    // Greeting uses the shared constant + server endpoint (no drift).
    expect(widget).toMatch(/VOICE_GREETING_TEXT/);
    expect(widget).toMatch(/\/greet/);
    expect(widget).toMatch(/speakGreeting/);
    // Mic denial falls through to the text-capable path (text survives).
    expect(widget).toMatch(/startTextMode/);
  });
});
