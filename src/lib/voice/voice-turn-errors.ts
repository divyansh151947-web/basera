/**
 * STT-stage error mapping for POST /api/voice/session/[id]/turn.
 *
 * Pure function (no I/O) so the no-masking rules are unit-testable:
 * - transcription-incapable provider + real audio → 503 capability error
 *   (never "could not hear", never generic "Invalid input").
 * - confirmed empty STT result (provider returned 200 with no text) → 400
 *   "couldn't hear" — the ONLY case allowed to say that.
 * - provider errors keep generic shapes; bodies are never echoed. All
 *   messages here are fixed literals safe for the client to display.
 * 
 * Error categorization:
 * - permission_denied: microphone access denied
 * - provider_unavailable: Gemini quota, 503, network issues
 * - stt_error: transcription failed
 * - tts_error: synthesis failed
 * - network_error: generic network failure
 */
export function mapVoiceTurnError(err: unknown): { status: number; error: string; code: string } {
  if (err instanceof Error && /Voice session not found/i.test(err.message)) {
    return { status: 404, error: "Invalid session", code: "not_found" };
  }
  if (err instanceof Error && /has ended/i.test(err.message)) {
    return { status: 410, error: "Voice session has ended.", code: "ended" };
  }
  if (err instanceof Error && /send a shorter message/i.test(err.message)) {
    return { status: 413, error: "Voice audio is too long.", code: "oversize" };
  }
  if (
    err instanceof Error &&
    /rate-limited|rate limited|quota|resource.exhausted|exhausted|temporarily unavailable|provider capacity|failed temporarily/i.test(
      err.message
    )
  ) {
    // Free-tier/standard throttling (STT or TTS), an exhausted quota, or a
    // transient provider capacity spike (Google answers these 503
    // UNAVAILABLE): tell the user to slow down or try later instead of masking
    // it as a generic failure. The client resumes listening (non-fatal) rather
    // than tearing the session down, because the next turn can still succeed.
    return { status: 429, error: "Voice provider quota exceeded or rate-limited. Please try again shortly.", code: "provider_unavailable" };
  }
  if (err instanceof Error && /cannot process audio/i.test(err.message)) {
    return { status: 503, error: "Voice transcription is not available on this server.", code: "stt_error" };
  }
  if (
    err instanceof Error &&
    /not supported for transcription|unsupported audio|rejected by the audio provider|audio format/i.test(err.message)
  ) {
    // A clip the provider will not decode (bad container/codec, or a
    // truncated/empty recording). Client-correctable: report it and keep the
    // microphone open instead of ending the session.
    return { status: 400, error: "That audio could not be transcribed. Please try again.", code: "stt_error" };
  }
  if (err instanceof Error && /produced no text/i.test(err.message)) {
    return { status: 400, error: "Sorry, I couldn't hear that. Please try again.", code: "stt_error" };
  }
  if (err instanceof Error && /Empty voice transcript|too long|provider/i.test(err.message)) {
    return { status: 400, error: "Invalid input", code: "invalid_input" };
  }
  if (err instanceof Error && /permission|denied|NotAllowedError|NotFoundError|SecurityError|NotReadableError|OverconstrainedError/i.test(err.message)) {
    return { status: 403, error: "Microphone access was denied. Please allow microphone access and try again.", code: "permission_denied" };
  }
  if (err instanceof Error && /network|fetch|connection|timeout|timed out/i.test(err.message)) {
    return { status: 503, error: "Network error. Please check your connection and try again.", code: "network_error" };
  }
  return { status: 500, error: "Internal server error", code: "server_error" };
}
