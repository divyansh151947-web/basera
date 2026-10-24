/**
 * Secret-free stage diagnostics for the voice audio path.
 *
 * Every playback stage (greeting fetch, TTS bytes, playback start, autoplay
 * block, media error, cleanup) can log here. The logger deliberately accepts
 * only primitives and caps what it prints: audio bytes, transcripts, keys and
 * provider payloads must NEVER reach the console, so callers pass lengths,
 * mime types and error names only.
 */

export type VoiceDiagValue = string | number | boolean | null;

export function voiceDiag(stage: string, detail: Record<string, VoiceDiagValue> = {}): void {
  try {
    const safe: Record<string, VoiceDiagValue> = {};
    for (const [key, value] of Object.entries(detail)) {
      if (typeof value === "string") safe[key] = value.slice(0, 64);
      else safe[key] = value;
    }
    console.debug(`[VoiceDiag] ${stage}`, safe);
  } catch {
    /* diagnostics must never break playback */
  }
}
