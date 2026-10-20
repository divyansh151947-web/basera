import "server-only";
import type {
  VoiceProvider,
  VoiceSynthesizeInput,
  VoiceSynthesizeResult,
  VoiceTurnInput,
  VoiceTurnResult,
} from "./voice-provider";

/**
 * MOCK VOICE PROVIDER (development + tests only).
 *
 * Honest stand-in: it moves TEXT through the session pipeline so the full
 * application flow (turn → Basera AI → reply → transcript) can be exercised
 * with zero credentials. It processes NO audio, contacts NO vendor, and
 * says so on every result. Production mode MUST NOT select this provider.
 */
export const MOCK_PROCESSING_NOTE =
  "Mock voice provider: no audio captured, transcribed, or synthesized; transcript text passed through for development only.";

export class MockVoiceProvider implements VoiceProvider {
  readonly id = "mock";
  readonly mode = "mock" as const;
  readonly label = "Mock voice provider (development only)";

  async prepareTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    if (input.audioBase64) {
      throw new Error("Mock voice provider cannot process audio. Use typed transcripts in mock mode.");
    }
    const transcriptText = input.transcriptText.trim();
    if (!transcriptText) throw new Error("Empty voice transcript.");
    if (transcriptText.length > 2000) throw new Error("Voice transcript too long.");
    return {
      transcriptText,
      language: input.language,
      mock: true,
      processingNote: MOCK_PROCESSING_NOTE,
      providerMetadata: { provider: "mock", audioProcessedBy: "none (text passthrough)" },
    };
  }

  async synthesizeReply(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult> {
    void input;
    return {
      audioBase64: null,
      audioMimeType: null,
      mock: true,
      processingNote: `${MOCK_PROCESSING_NOTE} Reply text returned for browser speech synthesis; no server audio generated.`,
      providerMetadata: { provider: "mock", audioProcessedBy: "none (browser speech synthesis)" },
    };
  }
}

export function isMockVoiceProvider(value: unknown): value is MockVoiceProvider {
  return value instanceof MockVoiceProvider;
}
