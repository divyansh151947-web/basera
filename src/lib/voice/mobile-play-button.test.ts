import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..", "..");
const read = (rel: string) => readFileSync(resolve(srcRoot, rel), "utf8");

/** Widget source with comments stripped (comments legitimately document
 *  controls' absence, but these assertions cover real behavior). */
const widget = () =>
  read("components/voice-session-widget.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Slice of a `const <name> = ...` callback body (up to its dependency list). */
const bodyOf = (source: string, marker: string) => {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const slice = source.slice(start);
  const end = slice.indexOf("}, [");
  return end > -1 ? slice.slice(0, end) : slice;
};

/** Slice between two markers (for code nested where `}, [` is ambiguous). */
const segment = (source: string, from: string, to: string) => {
  const a = source.indexOf(from);
  expect(a).toBeGreaterThan(-1);
  const b = source.indexOf(to, a);
  expect(b).toBeGreaterThan(-1);
  return source.slice(a, b);
};

/**
 * Mobile reply-audio contract:
 * - every AI reply's clip is reachable through one prominent tap;
 * - the tap plays the clip of the CORRECT (latest) response;
 * - clips survive autoplay rejection until success or explicit dismiss;
 * - stopping a reply via tap never wedges the listening loop;
 * - a TTS miss shows an error + a tap-to-speak retry and never a stale clip.
 */
describe("voice audio — mobile play-reply contract", () => {
  it("keeps the latest greeting/reply clip from arrival, not only after a failure", () => {
    const w = widget();
    // playClip registers the clip BEFORE playback is attempted.
    const playClipBody = bodyOf(w, "const playClip = useCallback(");
    expect(playClipBody).toMatch(/offerReplay\(\);/);
    expect(playClipBody.indexOf("offerReplay();")).toBeLessThan(playClipBody.indexOf("player.play("));
    // The reply path registers its clip as soon as it arrives too.
    expect(w).toMatch(/kind: "reply", blocked: false/);
  });

  it("shows the prominent labelled button whenever a clip exists, with a blocked hint", () => {
    const w = widget();
    expect(w).toMatch(/\{replayClip && \(/);
    // Exact required label for replies, plus the greeting analog.
    expect(w).toMatch(/🔊 \{replayClip\.kind === "greeting" \? "Tap to Play Greeting" : "Tap to Play AI Reply"\}/);
    expect(w).toMatch(/Tap to Play AI Reply/);
    expect(w).toMatch(/Tap to Play Greeting/);
    expect(w).toMatch(/onClick=\{\(\) => void playReplayClip\(\)\}/);
    expect(w).toMatch(/browser blocked automatic playback/);
    // The button must not depend on an error having occurred first.
    expect(w).not.toMatch(/\{pendingAudio/);
  });

  it("manual playback unlocks audio inside the click gesture before playing", () => {
    const w = widget();
    const body = bodyOf(w, "const playReplayClip = useCallback(");
    const unlock = body.indexOf("unlockAudioDuringGesture()");
    expect(unlock).toBeGreaterThan(-1);
    expect(unlock).toBeLessThan(body.indexOf("playClip("));
    expect(unlock).toBeLessThan(body.indexOf("stopAuxiliaryPlayback()"));
  });

  it("the clip stays until success or an explicit dismiss (✕)", () => {
    const w = widget();
    // Start never clears it — only un-blocks on actual playback start.
    const playClipBody = bodyOf(w, "const playClip = useCallback(");
    expect(playClipBody).toMatch(/blocked: false/);
    expect(playClipBody).not.toMatch(/setReplayClip\(null\)/);
    // Explicit dismiss handler exists and is wired to a ✕ button.
    expect(w).toMatch(/const dismissReplay = useCallback/);
    expect(w).toMatch(/onClick=\{dismissReplay\}/);
    expect(w).toMatch(/aria-label="Dismiss play button"/);
  });

  it("the button plays the clip of the exact response it belongs to", () => {
    const w = widget();
    const replyBody = bodyOf(w, "const playAudioWithMicMute = useCallback(");
    // The SAME base64 the player receives is what the button stores.
    expect(replyBody).toMatch(/setReplayClip\(base64 \? \{ base64, mimeType: clipMime, kind: "reply"/);
    expect(replyBody).toMatch(/replyEndRef\.current = onEnded/);
    // Stale-callback guards compare the clip identity, never clobbering a
    // newer response's button with an older player's error/start events.
    expect(replyBody).toMatch(/current\.base64 === base64/);
  });

  it("stopping a reply from a tap releases the loop and the mic (never wedges)", () => {
    const w = widget();
    const stopBody = bodyOf(w, "const stopAuxiliaryPlayback = useCallback");
    // Capture-then-null: notify exactly once, never a stale double-release.
    expect(stopBody).toMatch(/const notify = replyEndRef\.current/);
    expect(stopBody).toMatch(/replyEndRef\.current = null/);
    expect(stopBody).toMatch(/notify\?\.\(\)/);
    // The raw player.stop() never fires onEnded, so the mic the reply muted
    // must be released right here or listening would stay dead.
    expect(stopBody).toMatch(/setMicMuted\(false\)/);
    expect(w).toMatch(/replyEndRef\.current = onEnded/);
    // finish() invalidates the callback once the reply settles.
    const replyBody = bodyOf(w, "const playAudioWithMicMute = useCallback(");
    expect(replyBody).toMatch(/replyEndRef\.current = null/);
  });

  it("clips with unplayable bytes are dropped so the button never lies", () => {
    const w = widget();
    expect(w).toMatch(/EmptyAudioError/);
    expect(w).toMatch(/DecodeError/);
    // Both playback paths guard it.
    expect(w).toMatch(/err\.name === "EmptyAudioError"/);
    expect(w).toMatch(/name === "EmptyAudioError"/);
  });

  it("a greeting whose bytes cannot play still sounds via the browser voice", () => {
    const w = widget();
    const greeting = bodyOf(w, "const speakGreeting = async");
    expect(greeting).toMatch(/outcome === "failed" && !heard/);
    expect(greeting).toMatch(/await speakText\(greeting\)/);
  });

  it("a TTS miss shows an error with a tap-to-speak retry and drops the stale clip", () => {
    const w = widget();
    // Error card + retry action (runs inside a tap → audible on mobile).
    expect(w).toMatch(/Voice audio could not be generated for this reply/);
    expect(w).toMatch(/Tap to Play with device voice/);
    const retryBody = bodyOf(w, "const playTtsMissedVoice = useCallback");
    expect(retryBody.indexOf("unlockAudioDuringGesture()")).toBeLessThan(retryBody.indexOf("speakText(text)"));
    // The turn intake clears the PREVIOUS clip when the new reply has no
    // audio, so the button can never replay a stale response.
    const sendSeg = segment(w, "const sendTurn = async", "const speakGreeting");
    expect(sendSeg).toMatch(/if \(data\?\.replyAudioBase64\)/);
    expect(sendSeg).toMatch(/setReplayClip\(null\)/);
    expect(sendSeg).toMatch(/setTtsMissed\(replyText \|\| null\)/);
    expect(sendSeg).toMatch(/stopAuxiliaryPlayback\(\)/);
    // A later turn WITH audio clears the error card.
    expect(sendSeg).toMatch(/setTtsMissed\(null\)/);
  });
});
