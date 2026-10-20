"use client";

/**
 * Transcribe Live Client — placeholder for the cascade architecture.
 * The real implementation uses LiveVoiceSession from live-voice-session.ts
 * which provides the complete Gemini Live integration with tool calls,
 * session resumption, barge-in, and model audio streaming.
 */

export interface TranscribeLiveState {
  status: "idle" | "connecting" | "listening" | "processing" | "speaking" | "error" | "ended";
  transcript: string;
  isFinal: boolean;
}

export class TranscribeLiveClient {
  private state: TranscribeLiveState = {
    status: "idle",
    transcript: "",
    isFinal: false,
  };

  private listeners: Set<(state: TranscribeLiveState) => void> = new Set();

  getState(): TranscribeLiveState {
    return this.state;
  }

  subscribe(listener: (state: TranscribeLiveState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(next: Partial<TranscribeLiveState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => {
      try {
        listener(this.state);
      } catch {
        // Ignore listener errors
      }
    });
  }

  async start(_language: string, _token: string): Promise<void> {
    this.emit({ status: "connecting" });
    // Placeholder - real implementation would connect to Transcribe Live
    // For now, use the existing LiveVoiceSession from live-voice-session.ts
    this.emit({ status: "listening" });
  }

  stop(): void {
    this.emit({ status: "ended" });
  }

  sendAudio(_pcm: Int16Array): void {
    // Placeholder
  }
}

export function createTranscribeLiveClient(): TranscribeLiveClient {
  return new TranscribeLiveClient();
}