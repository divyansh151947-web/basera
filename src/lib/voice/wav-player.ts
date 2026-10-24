"use client";

/**
 * TTS clip player (base64 → audible reply).
 *
 * Two playback paths, in order of preference:
 *
 * 1. Web Audio API — when the host supplies an AudioContext that was
 *    created/resumed inside a user gesture, decoded buffers play reliably on
 *    iPhone Safari and Android Chrome even seconds later (the context carries
 *    the gesture, the clip does not need its own).
 * 2. HTMLAudioElement — classic fallback. Its play() promise is where
 *    autoplay policies surface (NotAllowedError); that is detected and
 *    reported as a "blocked" error so the host can offer a manual
 *    Play button instead of losing the audio.
 *
 * Before any playback the clip is validated (non-empty base64, decodable
 * bytes, RIFF/WAVE structure with a non-zero data chunk) so an empty or
 * truncated TTS payload fails loudly with a named error instead of
 * "playing" silence. Diagnostics log sizes/durations/mime only — never the
 * audio bytes themselves.
 */

import { voiceDiag } from "./voice-diagnostics";

export interface WavPlayerCallbacks {
  onEnded(): void;
  onError(err: Error): void;
  /** Fires once playback has actually begun (started, not merely requested). */
  onStarted?(): void;
}

/** True when the error means the browser's autoplay policy blocked us. */
export function isAutoplayBlockedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message || "";
  return (
    err.name === "NotAllowedError" ||
    err.name === "NotSupportedError" ||
    /blocked|not allowed|user gesture|autoplay|disallowed by the user agent/i.test(message)
  );
}

function blockedError(): Error {
  const err = new Error("Audio playback was blocked by the browser. Tap Play to hear it.");
  err.name = "NotAllowedError";
  return err;
}

interface WavInfo {
  valid: boolean;
  durationMs: number | null;
}

/** Structural WAV check + duration from the fmt/data chunks. */
export function inspectWav(bytes: Uint8Array): WavInfo {
  if (bytes.length < 44) return { valid: false, durationMs: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => {
    let out = "";
    for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  };
  if (ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WAVE") return { valid: false, durationMs: null };
  let byteRate = 0;
  let dataSize: number | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 20 <= bytes.length) byteRate = view.getUint32(offset + 16, true);
    if (id === "data") {
      // 0xFFFFFFFF = streamed/unknown size: treat as present, duration unknown.
      dataSize = size === 0xffffffff ? null : size;
      break;
    }
    offset += 8 + size + (size % 2);
    if (size > bytes.length) break;
  }
  if (dataSize === 0) return { valid: false, durationMs: null };
  const durationMs =
    byteRate > 0 && dataSize !== null && dataSize > 0 && dataSize <= bytes.length
      ? Math.round((dataSize / byteRate) * 1000)
      : null;
  return { valid: true, durationMs };
}

function isRiffWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

/** decodeAudioData with callback+promise compatibility (older Safari). */
function decodeAudio(context: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (buffer: AudioBuffer) => {
      if (!settled) {
        settled = true;
        resolve(buffer);
      }
    };
    const bad = (cause: unknown) => {
      if (!settled) {
        settled = true;
        reject(cause instanceof Error ? cause : new Error("Audio decode failed."));
      }
    };
    try {
      const maybe = context.decodeAudioData(data, ok, bad as (e: DOMException) => void);
      if (maybe && typeof (maybe as Promise<AudioBuffer>).then === "function") {
        (maybe as Promise<AudioBuffer>).then(ok, bad);
      }
    } catch (err) {
      bad(err);
    }
  });
}

export class WavPlayer {
  private audio: HTMLAudioElement | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** Object URL of the in-flight element clip; revoked on every exit path. */
  private currentUrl: string | null = null;
  private callbacks: WavPlayerCallbacks;
  /** Exactly-once guard per play() call (ended and error are exclusive). */
  private settled = false;
  /** Set by stop(); checked after async decode so a clip stopped mid-decode
   *  can never begin playing after its owner moved on. */
  private stopped = false;
  /** Lets stop() resolve an in-flight play() without firing callbacks, so
   *  awaiting callers never hang on an interrupted clip. */
  private silentResolve: (() => void) | null = null;

  constructor(callbacks: WavPlayerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Play a base64-encoded audio clip. `audioContext`, when supplied, should
   * be a context already unlocked by a user gesture — it makes playback
   * reliable on mobile Safari/Chrome. The promise resolves when playback
   * ends (or immediately when stopped) and rejects only on failure.
   */
  async play(base64: string, mimeType = "audio/wav", audioContext?: AudioContext | null): Promise<void> {
    this.settled = false;
    this.stopped = false;
    const mime = (mimeType || "audio/wav").split(";")[0].trim().toLowerCase() || "audio/wav";

    if (!base64 || !base64.trim()) {
      const err = new Error("Received empty audio; nothing to play.");
      err.name = "EmptyAudioError";
      voiceDiag("play:rejected-empty", { mime });
      this.fail(err);
      throw err;
    }

    let bytes: Uint8Array;
    try {
      const binary = atobSafe(base64);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    } catch {
      const err = new Error("Audio data could not be decoded.");
      err.name = "DecodeError";
      voiceDiag("play:rejected-undecodable", { mime, base64Chars: base64.length });
      this.fail(err);
      throw err;
    }

    if (bytes.length === 0) {
      const err = new Error("Received empty audio; nothing to play.");
      err.name = "EmptyAudioError";
      voiceDiag("play:rejected-empty-bytes", { mime });
      this.fail(err);
      throw err;
    }

    const riff = isRiffWav(bytes);
    const container = riff ? "wav" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "other";
    let durationMs: number | null = null;
    if (riff) {
      const info = inspectWav(bytes);
      durationMs = info.durationMs;
      if (!info.valid) {
        const err = new Error("Audio clip contains no playable samples.");
        err.name = "EmptyAudioError";
        voiceDiag("play:rejected-invalid-wav", { mime, bytes: bytes.length });
        this.fail(err);
        throw err;
      }
    } else if (bytes.length < 128) {
      // Too small to hold audible speech in any supported container.
      const err = new Error("Audio clip contains no playable samples.");
      err.name = "EmptyAudioError";
      voiceDiag("play:rejected-tiny-clip", { mime, bytes: bytes.length, container });
      this.fail(err);
      throw err;
    }

    voiceDiag("play:validated", { mime, container, bytes: bytes.length, durationMs });

    // Preferred: Web Audio playback through the gesture-unlocked context.
    if (audioContext && audioContext.state !== "closed") {
      if (audioContext.state !== "running") {
        // Mobile browsers can leave the context suspended — or interrupted
        // (iOS after a call/route change/lock) — not just "suspended", so any
        // non-running state gets a resume attempt before we decide.
        await audioContext.resume().catch(() => undefined);
      }
      if (audioContext.state === "running") {
        try {
          const buffer = await decodeAudio(audioContext, bytes.slice().buffer as ArrayBuffer);
          if (this.stopped) {
            // stop() arrived while decoding: never start audio the owner
            // has already abandoned.
            voiceDiag("play:stopped-mid-decode", { mime, container });
            if (!this.settled) {
              this.settled = true;
              this.silentResolve = null;
              this.callbacks.onEnded();
            }
            return;
          }
          if (buffer && buffer.duration > 0) {
            // iOS can suspend/interrupt the context WHILE the clip decodes.
            // Starting a buffer on a non-running context "succeeds" without
            // sound and without error (the mobile silent-audio trap), so the
            // state is re-checked after the await and playback falls through
            // to the element path when the context is not actually running.
            if (audioContext.state !== "running") {
              await audioContext.resume().catch(() => undefined);
            }
            if (audioContext.state === "running") {
              return this.playWithBuffer(
                buffer,
                audioContext,
                {
                  mime,
                  container,
                  bytes: bytes.length,
                  durationMs: Math.round(buffer.duration * 1000),
                },
                () => this.playWithElement(bytes, mime, container, durationMs)
              );
            }
            voiceDiag("play:context-not-running", {
              mime,
              container,
              state: audioContext.state,
            });
          }
        } catch (err) {
          voiceDiag("play:webaudio-fallback", {
            mime,
            reason: err instanceof Error ? err.name : "decode_failed",
          });
        }
      } else {
        voiceDiag("play:context-not-running", { mime, container, state: audioContext.state });
      }
    }

    return this.playWithElement(bytes, mime, container, durationMs);
  }

  /** Web Audio path: no object URLs, no per-element unlock requirement.
   *  When the context refuses to start audible output (mobile: interrupted
   *  context, start() throwing) it falls back to the element path instead of
   *  reporting a phantom success or a premature error. */
  private playWithBuffer(
    buffer: AudioBuffer,
    context: AudioContext,
    diag: Record<string, string | number | null>,
    fallback: () => Promise<void>
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      this.silentResolve = resolve;
      const tryFallback = (reason: string) => {
        voiceDiag("play:webaudio-fallback-start", {
          ...diag,
          reason,
          state: context.state,
        });
        this.cleanupBuffer();
        this.silentResolve = null;
        // The element path always settles (ended/blocked/failed) and its
        // play() promise is what autoplay policies reliably reject on mobile —
        // so it either plays, or the host gets a real error to show a Play
        // button for. Never a silent "success".
        void fallback().then(resolve);
      };
      if (context.state !== "running") {
        tryFallback("context-not-running");
        return;
      }
      try {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        this.source = source;
        source.onended = () => {
          this.cleanupBuffer();
          if (this.settled) return;
          this.settled = true;
          voiceDiag("play:ended", { ...diag, via: "webaudio" });
          this.callbacks.onEnded();
          resolve();
        };
        source.start(0);
        this.callbacks.onStarted?.();
        voiceDiag("play:started", { ...diag, via: "webaudio" });
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Audio playback failed.");
        tryFallback(error.name || "start-failed");
      }
    });
  }

  /** HTMLAudioElement fallback path with correct blob MIME and blocked detection. */
  private playWithElement(
    bytes: Uint8Array,
    mime: string,
    container: string,
    durationMs: number | null
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      this.silentResolve = resolve;
      try {
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }));
        this.currentUrl = url;

        let el = this.audio;
        if (!el) {
          el = new Audio();
          this.audio = el;
        }

        const cleanup = () => {
          URL.revokeObjectURL(url);
          if (this.currentUrl === url) this.currentUrl = null;
          if (this.audio) {
            this.audio.onended = null;
            this.audio.onerror = null;
            this.audio = null;
          }
        };
        const diag = { mime, container, bytes: bytes.length, durationMs };

        el.onended = () => {
          cleanup();
          if (this.settled) return;
          this.settled = true;
          voiceDiag("play:ended", { ...diag, via: "element" });
          this.callbacks.onEnded();
          resolve();
        };
        el.onerror = () => {
          cleanup();
          if (this.settled) return;
          this.settled = true;
          const error = new Error("Audio playback failed.");
          voiceDiag("play:error", { via: "element", name: "MediaError" });
          this.callbacks.onError(error);
          resolve();
        };

        el.src = url;
        const played = el.play();
        if (played && typeof played.then === "function") {
          played.then(
            () => {
              this.callbacks.onStarted?.();
              voiceDiag("play:started", { ...diag, via: "element" });
            },
            (rejected: unknown) => {
              cleanup();
              if (this.settled) return;
              this.settled = true;
              const blocked = isAutoplayBlockedError(rejected);
              const error = blocked
                ? blockedError()
                : rejected instanceof Error
                  ? rejected
                  : new Error("Audio playback failed.");
              voiceDiag("play:error", {
                via: "element",
                name: error.name,
                blocked,
              });
              this.callbacks.onError(error);
              resolve();
            }
          );
        }
      } catch (err) {
        if (this.settled) return;
        this.settled = true;
        const error = err instanceof Error ? err : new Error("Audio playback failed.");
        voiceDiag("play:error", { via: "element", name: error.name });
        this.callbacks.onError(error);
        resolve();
      }
    });
  }

  /** Stop current playback immediately. Does not fire onEnded (an
   *  interruption is not a completion), but always settles the promise. */
  stop(): void {
    this.cleanupBuffer();
    if (this.audio) {
      try {
        this.audio.onended = null;
        this.audio.onerror = null;
        this.audio.pause();
        this.audio.src = "";
      } catch {
        // Best effort
      }
      this.audio = null;
    }
    // An interrupted clip can never reach its onended/onerror cleanup, so its
    // object URL must be revoked here too.
    if (this.currentUrl) {
      try {
        URL.revokeObjectURL(this.currentUrl);
      } catch {
        // Best effort
      }
      this.currentUrl = null;
    }
    if (this.silentResolve) {
      const resolve = this.silentResolve;
      this.silentResolve = null;
      this.settled = true;
      resolve();
    }
  }

  /** Clean up resources. */
  dispose(): void {
    this.stop();
  }

  private cleanupBuffer(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
        this.source.disconnect();
      } catch {
        // Best effort
      }
      this.source = null;
    }
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.callbacks.onError(error);
  }
}

/** Base64 decoding for audio payloads (browser atob, Node Buffer fallback). */
function atobSafe(base64: string): string {
  if (typeof atob === "function") return atob(base64);
  return Buffer.from(base64, "base64").toString("binary");
}
