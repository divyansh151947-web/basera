"use client";

/**
 * WAV Audio Player for TTS playback.
 * Handles WAV audio (base64) from the TTS endpoint.
 * Simple Audio element-based playback with promise-based completion.
 */

export interface WavPlayerCallbacks {
  onEnded(): void;
  onError(err: Error): void;
}

export class WavPlayer {
  private audio: HTMLAudioElement | null = null;
  private callbacks: WavPlayerCallbacks;

  constructor(callbacks: WavPlayerCallbacks) {
    this.callbacks = callbacks;
  }

  /** Play a base64-encoded WAV audio. Returns a promise that resolves when playback ends. */
  async play(base64: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));

        let el = this.audio;
        if (!el) {
          el = new Audio();
          this.audio = el;
        }

        const cleanup = () => {
          URL.revokeObjectURL(url);
          if (this.audio) {
            this.audio.onended = null;
            this.audio.onerror = null;
            this.audio = null;
          }
        };

        el.onended = () => {
          cleanup();
          this.callbacks.onEnded();
          resolve();
        };
        el.onerror = () => {
          cleanup();
          const err = new Error("Audio playback failed.");
          this.callbacks.onError(err);
          reject(err);
        };

        el.src = url;
        const played = el.play();
        if (played && typeof played.then === "function") {
          played.then(
            () => undefined,
            (err) => {
              cleanup();
              const error = err instanceof Error ? err : new Error("Audio playback was blocked by the browser.");
              this.callbacks.onError(error);
              reject(error);
            }
          );
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Audio playback failed.");
        this.callbacks.onError(error);
        reject(error);
      }
    });
  }

  /** Stop current playback immediately. */
  stop(): void {
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.src = "";
      } catch {
        // Best effort
      }
      this.audio = null;
    }
  }

  /** Clean up resources. */
  dispose(): void {
    this.stop();
  }
}

/** Base64 decoding for WAV audio. */
function atobPolyfill(base64: string): string {
  return typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
}