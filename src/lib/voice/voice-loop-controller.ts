/**
 * AUTOMATIC VOICE CONVERSATION LOOP (framework-free state machine).
 *
 * Owns the hands-free lifecycle with zero React/DOM imports so the whole
 * loop is unit-testable in Node:
 *
 *   idle → requesting-mic → listening ⇄ recording → processing
 *     → speaking → listening → … → ended
 *                            ↘ error (permission_denied | provider_unavailable
 *                              | stt_error | tts_error | network_error)
 *
 * HARD GUARANTEES (each covered by a focused test):
 * - start() success lands in `listening` with no further action (no Speak
 *   button, no manual step).
 * - Every AI reply auto-plays exactly once (audio when provided, else the
 *   injected text speaker); playback end auto-resumes listening.
 * - One recording produces exactly one turn; concurrent turns, recordings,
 *   and playbacks are impossible (singleton guards + turnInFlight flag).
 * - Silence/empty audio is discarded locally and NEVER uploaded.
 * - The microphone never records while AI audio plays — except the
 *   barge-in path below, which stops playback first.
 * - Barge-in: sustained mic energy while `speaking` stops playback and
 *   returns to `listening` (which then picks the speech up as a new turn).
 *   This is client-side energy gating, NOT provider VAD turn-taking; echo
 *   from loudspeakers can trigger it, so it needs sustained energy and is
 *   documented as best-effort in the final report.
 */

import { voiceDiag } from "./voice-diagnostics";

export type VoiceLoopState =
  | "idle"
  | "requesting-mic"
  | "greeting"
  | "listening"
  | "recording"
  | "processing"
  | "speaking"
  | "ended"
  | "error";

export type VoiceLoopErrorCode =
  | "permission_denied"
  | "provider_unavailable"
  | "stt_error"
  | "tts_error"
  | "network_error";

export interface VoiceLoopError extends Error {
  code: VoiceLoopErrorCode;
  /** Client-correctable failures (bad input, oversize, rate limit) resume
   *  listening instead of tearing the session down. */
  fatal: boolean;
}

/** Codes the server can send that mean "retrying may well work". Anything the
 *  server could not classify (or a missing/absent code) keeps the conservative
 *  default, so an unknown failure still ends the session rather than looping. */
const RECOVERABLE_SERVER_CODES = new Set<ServerVoiceErrorCode>([
  "provider_unavailable",
  "stt_error",
  "tts_error",
  "network_error",
]);

/** Error codes the turn endpoint can report. `not_configured` is deliberately
 *  excluded from recovery: retrying cannot conjure a missing credential. */
export type ServerVoiceErrorCode =
  | "not_found"
  | "ended"
  | "oversize"
  | "provider_unavailable"
  | "stt_error"
  | "tts_error"
  | "invalid_input"
  | "permission_denied"
  | "network_error"
  | "server_error";

/**
 * Turn a failed turn into a loop error.
 *
 * `serverCode` is the endpoint's own classification. When it names a
 * recoverable condition (capacity spike, quota, timeout, network blip,
 * unreadable clip) the failure is NON-FATAL: the microphone stays open and the
 * user simply speaks again, because one bad turn must not destroy a hands-free
 * conversation. Without that signal the historical defaults apply unchanged.
 */
export function toVoiceLoopError(
  status: number | null,
  message: string,
  serverCode?: string | null
): VoiceLoopError {
  let code: VoiceLoopErrorCode = "network_error";
  let fatal = true;
  if (status === 503) code = "provider_unavailable";
  else if (status === 429 || status === 400 || status === 413) {
    code = status === 429 ? "network_error" : "stt_error";
    fatal = false;
  } else if (/transcri/i.test(message)) code = "stt_error";
  else if (/synthes|tts|audio/i.test(message)) code = "tts_error";

  if (fatal && serverCode && serverCode !== "not_configured" && RECOVERABLE_SERVER_CODES.has(serverCode as ServerVoiceErrorCode)) {
    fatal = false;
    if (serverCode === "stt_error") code = "stt_error";
    else if (serverCode === "tts_error") code = "tts_error";
    else if (serverCode === "network_error") code = "network_error";
  }
  const err = new Error(message) as VoiceLoopError;
  err.code = code;
  err.fatal = fatal;
  return err;
}

export interface MicStreamLike {
  stop(): void;
}

export interface RecorderLike {
  readonly state: "inactive" | "recording" | "paused";
  stop(): void;
  /** Mute/unmute the microphone input without tearing down the stream. */
  setMuted(muted: boolean): void;
}

export interface PlayerHandle {
  stop(): void;
}

export interface TurnAudio {
  base64: string;
  mimeType: string;
  /** Milliseconds of detected speech in the clip (controller-accounted). */
  speechMs: number;
}

/** Raw recorded bytes supplied by the recorder adapter. Speech-duration
 *  accounting stays in the controller (it samples the energy itself). */
export interface RecordedAudio {
  base64: string;
  mimeType: string;
}

export interface TurnResult {
  reply: string;
  replyAudioBase64: string | null;
  replyAudioMimeType: string | null;
  /** Server-confirmed transcript: the exact USER text the AI pipeline ran on
   *  (STT output for voice turns, echoed input for typed turns). Shown in
   *  chat so the displayed message can never differ from what was processed.
   *  Null only when the host has nothing confirmed (falls back to the sent
   *  text, never to an invented message). */
  transcript: string | null;
}

export interface VoiceLoopDeps {
  requestMic(): Promise<MicStreamLike>;
  createRecorder(onStop: (audio: RecordedAudio | null) => void, onError: (err: Error) => void): RecorderLike;
  /** Current mic energy 0..1 (analyser peak). Called on every tick. */
  sampleEnergy(): number;
  /** Send one turn. Rejects with VoiceLoopError (use toVoiceLoopError). */
  sendTurn(audio: TurnAudio | null, transcriptText: string): Promise<TurnResult>;
  /** Play AI audio; onEnded MUST fire exactly once per play call. */
  playAudio(base64: string, mimeType: string, onEnded: () => void, onError: (err: Error) => void): PlayerHandle;
  /** Text fallback speaker (browser speech synthesis). Returns a promise that resolves when speech ends. */
  speakText(text: string): Promise<void>;
  /** Assistant greeting: persist-if-needed + speak, supplied by the host
   *  (it owns session/message plumbing). Must resolve even when playback
   *  fails; the controller proceeds to listening regardless. */
  speakGreeting(): Promise<void>;
  stopSpeaking(): void;
  scheduleTick(fn: () => void, ms: number): unknown;
  cancelTick(handle: unknown): void;
  now(): number;
  onState(state: VoiceLoopState): void;
  onError(code: VoiceLoopErrorCode, message: string): void;
  onTranscript(text: string): void;
  onReply(text: string): void;
}

export interface VoiceLoopOptions {
  /** Ticks between energy samples. */
  tickMs?: number;
  /** Energy above this starts a recording. */
  energyThreshold?: number;
  /** Consecutive above-threshold ticks required before recording begins.
   *  Rejects single-tick spikes (clicks/pops); ~2 ticks ≈ 240 ms. */
  triggerTicks?: number;
  /** Adaptive noise floor: the effective threshold is
   *  max(energyThreshold, ambientBaseline + floorMargin), where the baseline
   *  learns only from below-threshold (ambient) samples. Quiet rooms keep
   *  the configured threshold; noisy rooms stop false-triggering. */
  floorMargin?: number;
  /** Silence below threshold that ends a turn. */
  silenceMs?: number;
  /** Minimum detected speech to send (shorter clips are discarded). */
  minSpeechMs?: number;
  /** Hard cap per recording (prevents uncontrolled uploads). */
  maxRecordMs?: number;
  /** Sustained energy that interrupts AI playback. */
  bargeInEnergy?: number;
  /** How long barge-in energy must sustain before interrupting. */
  bargeInSustainMs?: number;
}

const DEFAULTS: Required<VoiceLoopOptions> = {
  tickMs: 100,
  energyThreshold: 0.04,
  triggerTicks: 2,
  floorMargin: 0.02,
  silenceMs: 1000,
  minSpeechMs: 300,
  maxRecordMs: 60000,
  bargeInEnergy: 0.25,
  bargeInSustainMs: 250,
};

export class VoiceLoopController {
  private state: VoiceLoopState = "idle";
  private readonly opts: Required<VoiceLoopOptions>;
  private tickHandle: unknown = null;
  private mic: MicStreamLike | null = null;
  private recorder: RecorderLike | null = null;
  private player: PlayerHandle | null = null;
  private turnInFlight = false;
  private startPromise: Promise<void> | null = null;
  private recordStartedAt = 0;
  private lastVoiceAt = 0;
  private speechMs = 0;
  private bargeInSince: number | null = null;
  private stopped = false;
  private greeted = false;
  /** Ambient-energy baseline (adaptive noise floor, listening only). */
  private noiseBaseline: number | null = null;
  /** Consecutive above-threshold ticks while listening (spike rejection). */
  private aboveCount = 0;

  constructor(
    private readonly deps: VoiceLoopDeps,
    options: VoiceLoopOptions = {}
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  getState(): VoiceLoopState {
    return this.state;
  }

  private setState(next: VoiceLoopState): void {
    this.state = next;
    this.deps.onState(next);
  }

  private fail(code: VoiceLoopErrorCode, message: string): void {
    this.recorder?.setMuted(false);
    this.teardownMedia();
    this.turnInFlight = false;
    this.setState("error");
    this.deps.onError(code, message);
  }

  private teardownMedia(): void {
    this.stopTick();
    try {
      this.recorder?.setMuted(false);
      this.recorder?.stop();
    } catch {
      // Best-effort cleanup only.
    }
    this.recorder = null;
    try {
      this.player?.stop();
    } catch {
      // Best-effort cleanup only.
    }
    this.player = null;
    this.deps.stopSpeaking();
    try {
      this.mic?.stop();
    } catch {
      // Best-effort cleanup only.
    }
    this.mic = null;
  }

  private startTick(): void {
    this.stopTick();
    this.tickHandle = this.deps.scheduleTick(() => this.tick(), this.opts.tickMs);
  }

  private stopTick(): void {
    if (this.tickHandle != null) {
      this.deps.cancelTick(this.tickHandle);
      this.tickHandle = null;
    }
  }

  /** Effective speech threshold: configured floor, raised by the learned
   *  ambient baseline plus margin in noisy rooms. Never lowered — quiet
   *  rooms keep the sensitive default so soft speech still triggers. */
  private effectiveThreshold(): number {
    const base = this.opts.energyThreshold;
    if (this.noiseBaseline == null) return base;
    return Math.max(base, this.noiseBaseline + this.opts.floorMargin);
  }

  /** Fold one listening sample into the noise baseline. Drops instantly to
   *  quieter floors, rises only 1% per tick toward louder rooms (a speech
   *  onset stays far above the floor for its whole utterance), and caps so a
   *  loud room can never push the threshold beyond normal speech. The very
   *  first sample is capped low so speech starting at session onset still
   *  triggers instead of being absorbed. */
  private learnAmbient(sample: number): void {
    if (this.noiseBaseline == null) {
      this.noiseBaseline = Math.min(sample, 0.04);
      return;
    }
    if (sample < this.noiseBaseline) this.noiseBaseline = sample;
    else this.noiseBaseline = Math.min(0.15, this.noiseBaseline + (sample - this.noiseBaseline) * 0.01);
  }

  /** The single entry point: mic permission → automatic listening.
   *  Concurrent calls share one in-flight start (single mic request). */
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.state !== "idle" && this.state !== "error" && this.state !== "ended") return;
    this.startPromise = this.doStart();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async doStart(): Promise<void> {
    this.stopped = false;
    this.setState("requesting-mic");
    try {
      this.mic = await this.deps.requestMic();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") {
        this.fail("permission_denied", "Microphone permission was denied. Allow microphone access, or type your message instead.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        this.fail("permission_denied", "No microphone device was detected. Connect a microphone and try again, or type your message instead.");
      } else if (name === "SecurityError") {
        this.fail("permission_denied", "Microphone access is blocked by the browser. This page may need HTTPS — allow microphone access, or type your message instead.");
      } else if (name === "NotReadableError" || name === "AbortError") {
        this.fail("permission_denied", "The microphone is already in use by another app or tab. Close it and try again, or type your message instead.");
      } else if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
        this.fail("permission_denied", "No microphone satisfies the required audio settings. Type your message instead.");
      } else {
        this.fail("permission_denied", "No microphone is available. Type your message instead.");
      }
      return;
    }
    // Auto-listen: no Speak button, no manual step.
    this.lastVoiceAt = this.deps.now();
    this.bargeInSince = null;
    this.setState("listening");
    this.startTick();
    await this.greet();
  }

  /** Typed-transcript fallback path (no-mic accessibility). Still exactly
   *  one turn, still auto-played reply. */
  async sendTypedTranscript(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.turnInFlight) return;
    if (this.state !== "listening" && this.state !== "recording" && this.state !== "idle" && this.state !== "greeting") return;
    await this.executeTurn(null, trimmed);
  }

  /** Text-capable start when no microphone exists: session binding without
   *  audio capture. Typed turns still auto-play replies; energy sampling
   *  simply yields silence. */
  async startTextOnly(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.state !== "idle" && this.state !== "error" && this.state !== "ended") return;
    this.startPromise = (async () => {
      this.stopped = false;
      this.lastVoiceAt = this.deps.now();
      this.bargeInSince = null;
      this.setState("listening");
      this.startTick();
      await this.greet();
    })();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Assistant greeting, exactly once per controller start: plays the shared
   * greeting (persisted server-side, idempotent there too) and lands in
   * `listening` when it completes — or immediately if playback fails, so a
   * greeting can never wedge the loop.
   */
  async greet(): Promise<void> {
    if (this.greeted || this.stopped) return;
    if (this.state !== "listening") return;
    this.greeted = true;
    this.setState("greeting");
    try {
      await this.deps.speakGreeting();
    } catch {
      // Greeting audio is best-effort; the persisted message stands alone.
    }
    if (!this.stopped) {
      this.lastVoiceAt = this.deps.now();
      this.setState("listening");
    }
  }

  async end(): Promise<void> {
    this.stopped = true;
    this.recorder?.setMuted(false);
    this.teardownMedia();
    this.turnInFlight = false;
    this.setState("ended");
  }

  private beginRecording(): void {
    if (this.state !== "listening" || this.recorder || this.turnInFlight) return;
    const startedAt = this.deps.now();
    let stopped = false;
    const finish = (audio: RecordedAudio | null) => {
      if (stopped) return;
      stopped = true;
      this.recorder = null;
      void this.finishRecording(audio, startedAt);
    };
    try {
      this.recorder = this.deps.createRecorder(finish, () => {
        if (stopped) return;
        stopped = true;
        this.recorder = null;
        // Recorder failure mid-turn: back to listening, no turn sent.
        if (!this.stopped && this.state === "recording") {
          this.setState("listening");
          this.lastVoiceAt = this.deps.now();
        }
      });
    } catch {
      return;
    }
    this.recordStartedAt = startedAt;
    this.lastVoiceAt = startedAt;
    this.speechMs = 0;
    this.setState("recording");
  }

  private async finishRecording(audio: RecordedAudio | null, startedAt: number): Promise<void> {
    void startedAt;
    if (this.stopped) {
      this.setState("ended");
      return;
    }
    // Silence/empty clips are discarded LOCALLY and never uploaded.
    if (!audio || !audio.base64 || this.speechMs < this.opts.minSpeechMs) {
      this.setState("listening");
      this.lastVoiceAt = this.deps.now();
      return;
    }
    await this.executeTurn({ ...audio, speechMs: this.speechMs }, "");
  }

  private async executeTurn(audio: TurnAudio | null, transcriptText: string): Promise<void> {
    if (this.turnInFlight) return;
    this.turnInFlight = true;
    this.setState("processing");
    let result: TurnResult;
    try {
      result = await this.deps.sendTurn(audio, transcriptText);
    } catch (err) {
      this.turnInFlight = false;
      if (err instanceof Error && "code" in err) {
        const loopErr = err as VoiceLoopError;
        if (!loopErr.fatal && !this.stopped) {
          // Soft failure (e.g. rate-limited, oversize clip): report it and
          // keep listening rather than abandoning the conversation.
          this.setState("listening");
          this.lastVoiceAt = this.deps.now();
          this.deps.onError(loopErr.code, loopErr.message);
          return;
        }
        this.fail(loopErr.code, loopErr.message);
      } else {
        this.fail("network_error", "That turn did not go through. Please try again.");
      }
      return;
    }
    this.turnInFlight = false;
    if (this.stopped) {
      this.setState("ended");
      return;
    }
    // Exactly one user message per turn, and always the CONFIRMED text: the
    // server transcript for voice turns (same string the AI ran on), the
    // typed text for typed turns. Runs only after sendTurn succeeds, so STT
    // or AI failures never fabricate a chat message.
    this.deps.onTranscript(result.transcript || transcriptText || "voice message");
    this.deps.onReply(result.reply);
    await this.playReply(result);
  }

  private async playReply(result: TurnResult): Promise<void> {
    // Singleton playback: stop anything previous before starting.
    try {
      this.player?.stop();
    } catch {
      // Best-effort cleanup only.
    }
    this.player = null;
    this.deps.stopSpeaking();
    this.setState("speaking");
    this.bargeInSince = null;
    // Mute microphone during AI speech to prevent self-capture.
    this.recorder?.setMuted(true);
    if (result.replyAudioBase64) {
      const mime = result.replyAudioMimeType || "audio/mpeg";
      let ended = false;
      const handleEnded = () => {
        if (ended) return;
        ended = true;
        this.player = null;
        this.afterSpeech();
      };
      try {
        this.player = this.deps.playAudio(result.replyAudioBase64, mime, handleEnded, (err) => {
          // Blocked (autoplay) or failed playback: the host keeps the clip
          // recoverable (Play reply button); the loop must not hang — resume
          // listening exactly as if playback had ended.
          voiceDiag("reply:playback-error", {
            name: err?.name || "unknown",
            bytes: result.replyAudioBase64?.length ?? 0,
            mime,
          });
          handleEnded();
        });
        return;
      } catch {
        handleEnded();
        return;
      }
    }
    // No provider audio (e.g. mock mode): browser speech synthesis fallback.
    try {
      await this.deps.speakText(result.reply);
    } finally {
      this.afterSpeech();
    }
  }

  private afterSpeech(): void {
    if (this.stopped) {
      this.setState("ended");
      return;
    }
    // Automatic resume: the loop continues with no button press.
    this.lastVoiceAt = this.deps.now();
    this.bargeInSince = null;
    this.recorder?.setMuted(false);
    this.setState("listening");
  }

  private tick(): void {
    if (this.stopped) return;
    const now = this.deps.now();
    const energy = this.deps.sampleEnergy();

    if (this.state === "speaking") {
      // Barge-in watch only: sustained energy stops playback, then the
      // normal listening path picks the speech up as a fresh turn.
      if (energy >= this.opts.bargeInEnergy) {
        if (this.bargeInSince == null) this.bargeInSince = now;
        if (now - this.bargeInSince >= this.opts.bargeInSustainMs) {
          try {
            this.player?.stop();
          } catch {
            // Best-effort cleanup only.
          }
          this.player = null;
          this.deps.stopSpeaking();
          this.bargeInSince = null;
          this.lastVoiceAt = now;
          this.setState("listening");
        }
      } else {
        this.bargeInSince = null;
      }
      return;
    }

    if (this.state !== "listening" && this.state !== "recording") return;
    if (this.turnInFlight) return;

    if (this.state === "listening") {
      // Learn first (ambient-only statistics: speech onsets stay far above
      // the floor, and sustained room hum is absorbed instead of triggering).
      this.learnAmbient(energy);
      const threshold = this.effectiveThreshold();
      if (energy >= threshold) {
        this.aboveCount += 1;
        if (this.aboveCount >= this.opts.triggerTicks) {
          this.aboveCount = 0;
          this.beginRecording();
        }
      } else {
        this.aboveCount = 0;
      }
      return;
    }

    // state === "recording"
    if (energy >= this.opts.energyThreshold) {
      this.lastVoiceAt = now;
      this.speechMs += this.opts.tickMs;
    }
    const silentFor = now - this.lastVoiceAt;
    const recordedFor = now - this.recordStartedAt;
    if (recordedFor >= this.opts.maxRecordMs) {
      // Hard cap: stop and send what we have (finishRecording re-checks
      // the minimum-speech gate, so silence still never uploads).
      try {
        this.recorder?.stop();
      } catch {
        this.recorder = null;
        this.setState("listening");
      }
      return;
    }
    if (silentFor >= this.opts.silenceMs) {
      try {
        this.recorder?.stop();
      } catch {
        this.recorder = null;
        this.setState("listening");
        this.lastVoiceAt = now;
      }
    }
  }
}
