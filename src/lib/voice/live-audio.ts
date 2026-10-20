"use client";

import type { LiveAudioEngine } from "./live-voice-session";

/**
 * Browser PCM tap for Live sessions: AudioWorklet captures microphone
 * Float32, downsamples to 16 kHz Int16, and emits ~200 ms transferable
 * chunks. ONE engine per Live session; stop() disconnects + closes.
 * Returns null when the browser cannot do this (host falls back to the
 * turn-based loop on the same session — never a stuck UI).
 */

const WORKLET_NAME = "basera-pcm-tap";

/** ~40 ms posts at 16 kHz: small enough for realtime latency, large enough
 *  to avoid WebSocket spam (25 messages/second of ~1.7 KB). */
const WORKLET_POST_SAMPLES = 640;

const WORKLET_SOURCE = `
class BaseraPcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this._carry = 0;
    this._acc = new Int16Array(${WORKLET_POST_SAMPLES});
    this._n = 0;
  }
  process(inputs) {
    const ch = inputs && inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;
    const step = sampleRate / 16000;
    let pos = this._carry;
    while (true) {
      const i0 = Math.floor(pos);
      if (i0 + 1 >= ch.length) break;
      const frac = pos - i0;
      const s = ch[i0] * (1 - frac) + ch[i0 + 1] * frac;
      const c = s < -1 ? -1 : s > 1 ? 1 : s;
      this._acc[this._n++] = c < 0 ? Math.round(c * 32768) : Math.round(c * 32767);
      if (this._n >= this._acc.length) this.flush();
      pos += step;
    }
    this._carry = Math.max(0, pos - Math.floor(pos));
    return true;
  }
  flush() {
    if (this._n === 0) return;
    const out = this._acc.slice(0, this._n);
    this._n = 0;
    this.port.postMessage({ pcm: out.buffer }, [out.buffer]);
  }
}
registerProcessor("${WORKLET_NAME}", BaseraPcmTap);
`;

class WorkletEngine implements LiveAudioEngine {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;

  constructor(private readonly audioContextFactory: () => AudioContext) {}

  async start(stream: unknown, onPcm: (pcm: Int16Array) => void): Promise<void> {
    const mediaStream = stream as MediaStream;
    const context = this.audioContextFactory();
    this.context = context;
    try {
      if (context.state === "suspended") {
        await context.resume().catch(() => undefined);
      }
      await context.audioWorklet.addModule(
        URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }))
      );
      const source = context.createMediaStreamSource(mediaStream);
      const gainNode = context.createGain();
      const node = new AudioWorkletNode(context, WORKLET_NAME);
      node.port.onmessage = (event: MessageEvent) => {
        const buffer = (event.data as { pcm?: unknown })?.pcm;
        if (buffer instanceof ArrayBuffer) onPcm(new Int16Array(buffer));
      };
      source.connect(gainNode);
      gainNode.connect(node);
      // Capture-only: never connected to destination, nothing audible.
      this.source = source;
      this.gainNode = gainNode;
      this.node = node;
    } catch {
      this.stop();
      throw new Error("Live audio capture failed.");
    }
  }

  stop(): void {
    try {
      this.node?.port.close();
      this.node?.disconnect();
    } catch {
      // Best-effort.
    }
    try {
      this.gainNode?.disconnect();
    } catch {
      // Best-effort.
    }
    try {
      this.source?.disconnect();
    } catch {
      // Best-effort.
    }
    this.node = null;
    this.gainNode = null;
    this.source = null;
    const context = this.context;
    this.context = null;
    if (context) {
      try {
        void context.close();
      } catch {
        // Best-effort.
      }
    }
  }

  setMuted(muted: boolean): void {
    if (this.gainNode) {
      this.gainNode.gain.value = muted ? 0 : 1;
    }
  }
}

/** Build the default worklet engine, or null when unsupported. Never throws. */
export function createWorkletEngine(): LiveAudioEngine | null {
  try {
    if (typeof window === "undefined" || typeof Blob !== "function") return null;
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    if (!("audioWorklet" in Context.prototype)) return null;
    return new WorkletEngine(() => new Context({ sampleRate: 48000, latencyHint: "interactive" }));
  } catch {
    return null;
  }
}

/** Minimal AudioContext surface the PCM player needs (real or stub). */
export function defaultDecodeBase64(base64: string): Uint8Array {
  // eslint-disable-next-line no-undef
  const binary = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface PcmPlayerContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  createBuffer(channels: number, length: number, sampleRate: number): PcmAudioBuffer;
  createBufferSource(): PcmBufferSource;
  readonly destination: unknown;
  resume?(): Promise<void> | void;
  close(): Promise<void> | void;
}

export interface PcmAudioBuffer {
  getChannelData(channel: number): Float32Array;
}

export interface PcmBufferSource {
  buffer: PcmAudioBuffer | null;
  connect(destination: unknown): void;
  disconnect(): void;
  start(when?: number): void;
  stop(): void;
  // Deliberately loose (DOM AudioScheduledSourceNode uses its own handler
  // type); the player only assigns its own closure or null here.
  onended: unknown;
}

/**
 * Progressive PCM player for streamed model audio (24 kHz mono 16-bit).
 * Chunks queue gaplessly via scheduled sources; playback starts with the
 * FIRST chunk (no full-download wait). stopAndClear() halts immediately
 * for barge-in. ONE instance per Live session; dispose() releases all.
 */
export class PcmPlayer {
  private nextStartTime = 0;
  private sources = new Set<PcmBufferSource>();
  private playing = false;
  private disposed = false;
  /** Fires when the queue fully drains after playback (listen-resume hook). */
  onDrained: (() => void) | null = null;

  constructor(
    private readonly context: PcmPlayerContext,
    private readonly decodeBase64: (base64: string) => Uint8Array = defaultDecodeBase64
  ) {}

  isPlaying(): boolean {
    return this.playing && !this.disposed;
  }

  /** Queue one base64 PCM chunk for gapless playback. */
  queueBase64(base64: string): void {
    if (this.disposed || !base64) return;
    let bytes: Uint8Array;
    try {
      bytes = this.decodeBase64(base64);
    } catch {
      return;
    }
    if (bytes.length < 2) return;
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const now = this.context.currentTime;
    // Gapless chain; if we fell behind (long stall), restart from now.
    const when = Math.max(now + 0.02, this.nextStartTime);
    if (when > now + 5) {
      try {
        source.disconnect();
      } catch {
        // Best-effort.
      }
      return;
    }
    this.nextStartTime = when + samples.length / 24000;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) {
        this.playing = false;
        try {
          this.onDrained?.();
        } catch {
          // Host callback must never break playback bookkeeping.
        }
      }
    };
    try {
      source.start(when);
      this.playing = true;
    } catch {
      this.sources.delete(source);
    }
  }

  /** Best-effort resume after tab-hidden suspension. */
  resume(): void {
    try {
      const result = this.context.resume?.();
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Best-effort.
    }
  }

  /** Barge-in: silence NOW, drop everything queued. */
  stopAndClear(): void {
    this.nextStartTime = 0;
    this.playing = false;
    for (const source of Array.from(this.sources)) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // Best-effort.
      }
    }
    this.sources.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.stopAndClear();
    try {
      const result = this.context.close();
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Best-effort.
    }
  }
}
