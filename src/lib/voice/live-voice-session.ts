import type { VoiceLanguage } from "./voice-provider";

/**
 * GEMINI LIVE REALTIME SESSION (framework-free state machine, no React/DOM
 * imports — fully unit-testable with injected fakes).
 *
 * Single realtime voice path: browser microphone PCM streams to Gemini Live
 * (server VAD + transcriptions + barge-in); the model answers through a
 * Basera tool call; Basera's exact reply is spoken back as streamed model
 * audio. No blob recording, no REST STT, no second TTS request on this path.
 *
 * Division of labor (load-bearing — do not blur):
 * - Gemini Live: audio transport, speech detection, transcription, speech.
 * - Basera server pipeline (via the existing turn endpoint): the ONLY place
 *   conversation context, qualification, matching, scoring, persistence, and
 *   the reply text live. The model must never invent business answers.
 *
 * Wire facts below are verified live against the Gemini API (not assumed):
 * - WS: wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage
 *   .v1beta.GenerativeService.BidiGenerateContent + ephemeral
 *   token as ?key= (tokens are Live-only, v1beta-only).
 * - Mic PCM: 16-bit mono 16 kHz little-endian base64 in realtimeInput.audio.
 * - Model audio out: 24 kHz PCM, arrives as TEXT frames (inlineData) or
 *   BINARY frames (raw bytes) — both are accepted.
 * - setupComplete itself may arrive as a BINARY UTF-8 frame; the parser
 *   decodes binary as text before JSON parsing. Ignoring non-text frames
 *   stalls the session forever (observed live).
 * - Native-audio Live models reject TEXT-only response modalities (server
 *   closes 1007). gemini-2.5-flash-native-audio-latest is the current recommended model
 *   for low-latency voice agents. Model id is env-overridable.
 * - Unknown shapes never throw and never fabricate transcripts; anything
 *   unrecoverable degrades to reconnect → caller fallback, never a stuck UI.
 */

export const LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/** Verified working default. Override with GEMINI_LIVE_MODEL when Google
 *  rotates the lineup; the server tells the client which model to use so
 *  the two can never drift. */
export const LIVE_DEFAULT_MODEL = "models/gemini-2.5-flash-native-audio-latest";

export function liveModelId(env: Record<string, string | undefined> = process.env): string {
  return env.GEMINI_LIVE_MODEL?.trim() || LIVE_DEFAULT_MODEL;
}

/** Server VAD tuning: HIGH start sensitivity catches quiet/fast speech with
 *  modest prefix padding (first word survives); HIGH end sensitivity with a
 *  generous silence window allows natural pauses without cutting off slow
 *  speakers. Field names per current Gemini Live API (startSensitivity,
 *  endSensitivity). 
 * 
 * For Hindi/Hinglish with natural pauses, we use:
 * - START_SENSITIVITY_HIGH: catches soft speech onset
 * - END_SENSITIVITY_HIGH: waits for genuine turn end
 * - prefixPaddingMs: 300ms (preserves first word for Indian languages)
 * - silenceDurationMs: 1000ms (allows natural Hindi pauses) */
export const LIVE_VAD_CONFIG = {
  disabled: false,
  startSensitivity: "START_SENSITIVITY_HIGH",
  endSensitivity: "END_SENSITIVITY_HIGH",
  prefixPaddingMs: 300,
  silenceDurationMs: 1000,
} as const;

export function liveSystemInstruction(language: VoiceLanguage): string {
  const base =
    "You are Basera Voice, the spoken interface of the Basera real-estate assistant. " +
    "For EVERY property question or user request, call basera_reply with the user's exact words, " +
    "then speak its reply text back VERBATIM — word for word, nothing added, nothing removed, no extra commentary. " +
    "Never invent properties, prices, availability, or business facts; all business answers come from basera_reply. " +
    "For greetings and small talk you may answer briefly yourself. " +
    "The user may speak English, Hindi (Devanagari), or Hinglish (Roman script Hindi-English mix). " +
    "Automatically detect the language and respond in the SAME language and script the user used. " +
    "If the user switches languages mid-conversation, seamlessly switch your response language to match. " +
    "IMPORTANT: Wait for the user to COMPLETE their turn before responding. Do not interrupt. " +
    "Support Indian number formats: 'lakh'/'lakhs'/'lac'/'lacs' = 100,000, 'crore'/'crores'/'करोड़' = 10,000,000. " +
    "Distinguish BHK (bedrooms) from budget: '2 BHK' ≠ '2 lakh', '3 crore' ≠ '3 BHK'. ";
  return base;
}

/** Tool declaration: the model's ONLY route to business answers. Pure. */
export function buildLiveTools(): object {
  return {
    functionDeclarations: [
      {
        name: "basera_reply",
        description:
          "Get Basera's authoritative reply for the user's transcribed speech. Call with the user's exact words, then speak the returned reply text verbatim.",
        parameters: {
          type: "object",
          properties: {
            transcript: {
              type: "string",
              description: "The user's exact spoken words from the input transcription.",
            },
          },
          required: ["transcript"],
        },
      },
    ],
  };
}

/** Exact setup frame for the Live session (field names per the official
 *  WebSockets API reference). AUDIO modality: this path speaks the model's
 *  streamed audio for Basera replies (no second TTS request). */
export function buildLiveSetup(model: string, language: VoiceLanguage, resumptionHandle?: string): object {
  const setup: {
    setup: {
      model: string;
      generationConfig: { responseModalities: string[]; speechConfig?: object };
      systemInstruction: { parts: Array<{ text: string }> };
      tools: object[];
      realtimeInputConfig: { automaticActivityDetection: typeof LIVE_VAD_CONFIG };
      inputAudioTranscription: Record<string, never>;
      outputAudioTranscription: Record<string, never>;
      sessionResumption?: { handle: string };
    };
  } = {
    setup: {
      model,
      generationConfig: { 
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" }
          }
        }
      },
      systemInstruction: { parts: [{ text: liveSystemInstruction(language) }] },
      tools: [buildLiveTools()],
      realtimeInputConfig: {
        automaticActivityDetection: { ...LIVE_VAD_CONFIG },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
  if (resumptionHandle) {
    setup.setup.sessionResumption = { handle: resumptionHandle };
  }
  return setup;
}

/** Tool-response frame answering one basera_reply call. Pure. */
export function buildToolResponse(callId: string, reply: string): object {
  return {
    toolResponse: {
      functionResponses: [{ id: callId, name: "basera_reply", response: { reply } }],
    },
  };
}

/** Bounded FIFO for model-audio chunks that arrive before their turn's tool
 *  answer. Lets playback start the instant the answer exists (no invented
 *  speech ever plays). Caps memory; oldest chunks drop beyond capacity.
 *  Pure logic (unit-tested); the host owns the actual player. */
export class HeldAudioBuffer {
  private chunks: string[] = [];

  constructor(private readonly maxChunks = 125) {}

  get size(): number {
    return this.chunks.length;
  }

  push(base64: string): void {
    if (!base64) return;
    this.chunks.push(base64);
    while (this.chunks.length > this.maxChunks) this.chunks.shift();
  }

  /** Drain in order; buffer is empty afterwards. */
  drain(): string[] {
    const out = this.chunks;
    this.chunks = [];
    return out;
  }

  clear(): void {
    this.chunks = [];
  }
}

/** Downsample Float32 mono to 16-bit PCM at 16 kHz. Pure (unit-tested). */
export function downsampleToPcm16(input: Float32Array, inRate: number, outRate = 16000): Int16Array {
  if (!Number.isFinite(inRate) || inRate <= 0) return new Int16Array(0);
  if (input.length === 0) return new Int16Array(0);
  const step = inRate / outRate;
  const length = Math.max(0, Math.floor(input.length / step));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    const sample = input[i0] * (1 - frac) + input[i1] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }
  return out;
}

/** Base64 without blowing the call stack on large buffers. Pure. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  // eslint-disable-next-line no-undef
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

/** Decode a socket frame payload to text. TEXT frames pass through; binary
 *  frames (ArrayBuffer, views, or Blobs) decode as UTF-8 — the server has
 *  been observed sending setupComplete this way. Returns null when there is
 *  genuinely no text (e.g. raw model-audio bytes, handled separately). */
export function frameToText(data: unknown): string | null {
  if (typeof data === "string") return data;
  try {
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) {
      const view = data as Uint8Array;
      return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    }
  } catch {
    return null;
  }
  return null;
}

export type LiveServerEvent =
  | { kind: "setup-complete" }
  | { kind: "input-transcript"; text: string; final: boolean }
  | { kind: "output-transcript"; text: string }
  | { kind: "model-audio"; base64: string }
  | { kind: "tool-call"; id: string; transcript: string }
  | { kind: "interrupted" }
  | { kind: "turn-complete" }
  | { kind: "go-away"; timeLeftSeconds: number | null; resumptionHandle?: string }
  | { kind: "unknown" };

function goAwaySeconds(value: unknown): { timeLeftSeconds: number | null; resumptionHandle?: string } {
  if (value == null || typeof value !== "object") return { timeLeftSeconds: null };
  const obj = value as Record<string, unknown>;
  const raw = obj.timeLeft;
  const parsed = typeof raw === "string" ? Number.parseFloat(raw) : null;
  const timeLeftSeconds = Number.isFinite(parsed) ? (parsed as number) : null;
  const handle = obj.resumptionHandle;
  const resumptionHandle = typeof handle === "string" && handle.length > 0 ? handle : undefined;
  return { timeLeftSeconds, resumptionHandle };
}

/** Inline model audio (base64 PCM) from a modelTurn part, if present. */
function partAudio(part: unknown): string | null {
  const inline = (part as { inlineData?: unknown })?.inlineData as
    | { mimeType?: unknown; data?: unknown }
    | undefined;
  if (inline && typeof inline.data === "string" && inline.data.length > 0) return inline.data;
  return null;
}

/** Classify one parsed server message. Defensive: unknown shapes never throw
 *  and never fabricate transcripts or audio. */
export function parseLiveServerMessage(data: unknown): LiveServerEvent[] {
  if (data == null || typeof data !== "object") return [{ kind: "unknown" }];
  const msg = data as Record<string, unknown>;
  const events: LiveServerEvent[] = [];
  if ("setupComplete" in msg) events.push({ kind: "setup-complete" });
  const serverContent = msg.serverContent as Record<string, unknown> | undefined;
  if (serverContent && typeof serverContent === "object") {
    if (serverContent.interrupted === true) events.push({ kind: "interrupted" });
    const input = serverContent.inputTranscription as { text?: unknown } | undefined;
    if (input && typeof input.text === "string" && input.text.trim()) {
      events.push({ kind: "input-transcript", text: input.text.trim(), final: serverContent.turnComplete === true });
    }
    const output = serverContent.outputTranscription as { text?: unknown } | undefined;
    if (output && typeof output.text === "string" && output.text.trim()) {
      events.push({ kind: "output-transcript", text: output.text.trim() });
    }
    const modelTurn = serverContent.modelTurn as { parts?: unknown } | undefined;
    if (modelTurn && Array.isArray(modelTurn.parts)) {
      for (const part of modelTurn.parts) {
        const audio = partAudio(part);
        if (audio) events.push({ kind: "model-audio", base64: audio });
      }
    }
    if (serverContent.turnComplete === true) events.push({ kind: "turn-complete" });
    if (msg.goAway !== undefined) {
      const goAway = goAwaySeconds(msg.goAway);
      events.push({ kind: "go-away", timeLeftSeconds: goAway.timeLeftSeconds, resumptionHandle: goAway.resumptionHandle });
    }
} else if (msg.goAway !== undefined) {
      const goAway = goAwaySeconds(msg.goAway);
      events.push({ kind: "go-away", timeLeftSeconds: goAway.timeLeftSeconds, resumptionHandle: goAway.resumptionHandle });
    }
  // toolCall is a top-level server-message field (may arrive with or
  // without a serverContent block in the same frame).
  const toolCall = msg.toolCall as
    | { functionCalls?: Array<{ id?: unknown; name?: unknown; args?: unknown }> }
    | undefined;
  if (toolCall && Array.isArray(toolCall.functionCalls)) {
    for (const call of toolCall.functionCalls) {
      if (call && call.name === "basera_reply") {
        const args = (call.args ?? {}) as { transcript?: unknown };
        events.push({
          kind: "tool-call",
          id: typeof call.id === "string" ? call.id : "",
          transcript: typeof args.transcript === "string" ? args.transcript : "",
        });
      }
    }
  }
  return events.length > 0 ? events : [{ kind: "unknown" }];
}

export type LiveVoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "reconnecting"
  | "ended"
  | "error";

export interface LiveSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

export interface LiveMicHandle {
  stream: unknown;
  stop(): void;
}

export interface LiveAudioEngine {
  /** Start tapping mic PCM (Int16 @16 kHz) into onPcm. Rejects when
   *  unsupported so the host can fall back immediately. */
  start(stream: unknown, onPcm: (pcm: Int16Array) => void): Promise<void> | void;
  stop(): void;
  /** Mute/unmute the microphone input without tearing down the stream. */
  setMuted(muted: boolean): void;
}

export interface LiveVoiceCallbacks {
  onState(state: LiveVoiceState): void;
  /** Final server transcript for one user turn (ground-truth display
   *  fallback; the tool-call argument is primary). */
  onFinalTranscript(text: string): void;
  /** Spoken-assistant text as actually rendered (output transcription). */
  onAssistantTranscript(text: string): void;
  /** Streamed model audio chunk (base64 PCM 24 kHz) for progressive playback. */
  onModelAudio(base64: string): void;
  /** basera_reply tool call: resolve via the Basera pipeline, then answer
   *  with answerToolCall(callId, reply). Exactly-once per call id. */
  onToolCall(callId: string, transcript: string): void;
  /** A model turn fully completed server-side. */
  onTurnComplete(): void;
  /** Server reported interruption (or go-away): stop our playback now. */
  onInterrupted(): void;
  /** Live path unusable (setup rejected, reconnects exhausted, unsupported):
   *  the host falls back to the turn-based loop on the SAME session. */
  onGiveUp(message: string): void;
  /** Greeting should be played (exactly once per session start). */
  onGreeting?(): void;
  /** Development diagnostics hook (stage transitions only — never audio,
   *  transcripts, tokens, or keys). Optional; ignored when unset. */
  onEvent?(name: string, detail?: string): void;
}

export interface LiveVoiceDeps {
  socketFactory(url: string): LiveSocket;
  micFactory(): Promise<LiveMicHandle>;
  audioFactory(): LiveAudioEngine | null;
  tokenProvider(): Promise<{ token: string; model: string } | null>;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

export interface LiveVoiceOptions {
  maxReconnects?: number;
}

const RECONNECT_DELAYS = [1000, 2000, 4000];

/** One stable Live session per voice conversation. Owns exactly one socket,
 *  one mic stream, and one PCM tap; everything is torn down on stop(). */
export class LiveVoiceSession {
  private state: LiveVoiceState = "idle";
  private readonly maxReconnects: number;
  private socket: LiveSocket | null = null;
  private mic: LiveMicHandle | null = null;
  private engine: LiveAudioEngine | null = null;
  private reconnects = 0;
  private reconnectHandle: unknown = null;
  private setupTimer: unknown = null;
  private stopped = false;
  private setupDone = false;
  private micStreamForHost: unknown = null;
  private language: VoiceLanguage = "en";
  private answeredToolCalls = new Set<string>();
  private resumptionHandle: string | null = null;
  private greetingPlayed = false;
  private hasGreetedThisSession = false;
  private isPlayingModelAudio = false;

  constructor(
    private readonly deps: LiveVoiceDeps,
    private readonly callbacks: LiveVoiceCallbacks,
    options: LiveVoiceOptions = {}
  ) {
    this.maxReconnects = options.maxReconnects ?? 3;
  }

  getState(): LiveVoiceState {
    return this.state;
  }

  /** Mic stream for the host (shared analyser/energy UI — never duplicated). */
  getMicStream(): unknown {
    return this.micStreamForHost;
  }

  /** Mute/unmute microphone input at the audio engine level.
   *  Prevents self-hearing during AI playback (including REST fallback turns). */
  setMuted(muted: boolean): void {
    this.engine?.setMuted(muted);
  }

  private setState(next: LiveVoiceState): void {
    this.state = next;
    this.callbacks.onState(next);
  }

  /** Stage diagnostics for development (safe strings only — the manager
   *  never sees keys, and never emits audio or transcript content). */
  private emit(name: string, detail?: string): void {
    try {
      this.callbacks.onEvent?.(name, detail);
    } catch {
      // Diagnostics must never break the session.
    }
  }

  async start(language: VoiceLanguage): Promise<void> {
    if (this.state !== "idle" && this.state !== "error") return;
    this.stopped = false;
    this.reconnects = 0;
    this.language = language;
    this.hasGreetedThisSession = false; // Reset greeting flag for new session
    this.setState("connecting");
    const creds = await this.deps.tokenProvider().catch(() => null);
    if (this.stopped) return;
    if (!creds) {
      this.shutdown();
      this.callbacks.onGiveUp("Live voice is unavailable right now.");
      return;
    }
    await this.connect(creds.token, creds.model, language);
  }

  /** Answer one basera_reply tool call with Basera's exact reply text. The
   *  model then speaks it (its output transcription is the spoken record).
   *  Each call id is answered at most once (no duplicate tool responses). */
  answerToolCall(callId: string, reply: string): void {
    const socket = this.socket;
    if (!socket || this.stopped || !this.setupDone || !callId) return;
    if (this.answeredToolCalls.has(callId)) return;
    this.answeredToolCalls.add(callId);
    try {
      socket.send(JSON.stringify(buildToolResponse(callId, reply)));
    } catch {
      // Send failures surface via socket error/close; never throw into UI.
    }
  }

  private async connect(token: string, model: string, language: VoiceLanguage): Promise<void> {
    this.teardownTransport();
    this.setupDone = false;
    // Preserve hasGreetedThisSession across reconnects
    let mic: LiveMicHandle;
    try {
      mic = await this.deps.micFactory();
    } catch {
      if (!this.stopped) {
        this.shutdown();
        this.callbacks.onGiveUp("Microphone could not be started for live voice.");
      }
      return;
    }
    if (this.stopped) {
      try {
        mic.stop();
      } catch {
        // Best-effort.
      }
      return;
    }
    this.mic = mic;
    this.micStreamForHost = mic.stream;
    this.emit("mic-started");
    const engine = this.deps.audioFactory();
    if (!engine) {
      this.shutdown();
      this.callbacks.onGiveUp("Live audio capture is not supported in this browser.");
      return;
    }
    this.engine = engine;
    const socket = this.deps.socketFactory(`${LIVE_WS_URL}?access_token=${encodeURIComponent(token)}`);
    this.socket = socket;
    socket.onopen = () => {
      if (this.stopped) return;
      this.emit("socket-open");
      try {
        socket.send(JSON.stringify(buildLiveSetup(model, language, this.resumptionHandle ?? undefined)));
        this.emit("setup-sent", model);
      } catch {
        this.onTransportLost("Live voice connection failed.");
        return;
      }
      this.armSetupTimeout();
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => this.onTransportLost("Live voice connection failed.");
    socket.onclose = () => {
      if (!this.stopped && this.state !== "idle" && this.state !== "ended") {
        this.onTransportLost("Live voice connection closed.");
      }
    };
    try {
      await engine.start(mic.stream, (pcm) => this.sendPcm(pcm));
      this.emit("pcm-streaming");
    } catch {
      this.onTransportLost("Live audio capture failed.");
      return;
    }
  }

  private armSetupTimeout(): void {
    this.clearSetupTimeout();
    this.setupTimer = this.deps.schedule(() => {
      this.setupTimer = null;
      if (!this.setupDone && !this.stopped) this.onTransportLost("Live voice did not respond in time.");
    }, 8000);
  }

  private clearSetupTimeout(): void {
    if (this.setupTimer != null) {
      this.deps.cancel(this.setupTimer);
      this.setupTimer = null;
    }
  }

  private sendPcm(pcm: Int16Array): void {
    const socket = this.socket;
    if (!socket || this.stopped || pcm.length === 0) return;
    try {
      socket.send(
        JSON.stringify({
          realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)) } },
        })
      );
    } catch {
      // Send failures surface via socket error/close; never throw into audio.
    }
  }

  private handleMessage(data: unknown): void {
    if (this.stopped) return;
    const text = frameToText(data);
    if (text == null) return; // Raw model-audio bytes carry no events (played by the host player).
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    for (const event of parseLiveServerMessage(parsed)) {
      if (this.stopped) return;
      if (event.kind === "setup-complete") {
        this.setupDone = true;
        this.clearSetupTimeout();
        this.reconnects = 0;
        this.emit("setup-complete");
        this.setState("listening");
        // Trigger greeting only once per session (not on reconnect)
        if (!this.hasGreetedThisSession) {
          this.hasGreetedThisSession = true;
          this.callbacks.onGreeting?.();
        }
      } else if (event.kind === "input-transcript") {
        if (event.final && event.text.trim()) {
          this.emit("input-transcript-final", `${event.text.trim().length}ch`);
          this.callbacks.onFinalTranscript(event.text.trim());
        } else if (!event.final) {
          this.emit("input-transcript-partial");
        }
      } else if (event.kind === "output-transcript") {
        this.callbacks.onAssistantTranscript(event.text);
      } else if (event.kind === "model-audio") {
        if (!this.isPlayingModelAudio) {
          this.isPlayingModelAudio = true;
          this.engine?.setMuted(true);
          this.setState("speaking");
        }
        this.emit("model-audio-chunk", `${event.base64.length}b`);
        this.callbacks.onModelAudio(event.base64);
      } else if (event.kind === "tool-call") {
        this.emit("tool-call", `${event.transcript.length}ch`);
        this.callbacks.onToolCall(event.id, event.transcript);
      } else if (event.kind === "interrupted") {
        this.emit("interrupted");
        this.callbacks.onInterrupted();
        if (this.isPlayingModelAudio) {
          this.isPlayingModelAudio = false;
          this.engine?.setMuted(false);
        }
        if (!this.stopped) this.setState("listening");
      } else if (event.kind === "turn-complete") {
        this.emit("turn-complete");
        this.callbacks.onTurnComplete();
        if (this.isPlayingModelAudio) {
          this.isPlayingModelAudio = false;
          this.engine?.setMuted(false);
        }
        if (!this.stopped) this.setState("listening");
      } else if (event.kind === "go-away") {
        this.emit("go-away");
        this.callbacks.onInterrupted();
        // Capture resumption handle for session resumption on reconnect
        if (event.resumptionHandle) {
          this.resumptionHandle = event.resumptionHandle;
          this.emit("resumption-handle-updated", event.resumptionHandle);
        }
        this.reconnectSoon();
      }
    }
  }

  private onTransportLost(message: string): void {
    if (this.stopped) return;
    this.emit("transport-lost");
    this.teardownTransport();
    if (this.reconnects >= this.maxReconnects) {
      this.shutdown();
      this.callbacks.onGiveUp(message);
      return;
    }
    this.reconnects += 1;
    this.setState("reconnecting");
    const delay = RECONNECT_DELAYS[Math.min(this.reconnects - 1, RECONNECT_DELAYS.length - 1)];
    this.reconnectHandle = this.deps.schedule(() => {
      this.reconnectHandle = null;
      if (this.stopped) return;
      void this.restartWithFreshToken();
    }, delay);
  }

  private async restartWithFreshToken(): Promise<void> {
    // Reconnects need a fresh single-use token; the session language is
    // preserved so Hindi/Hinglish sessions resume correctly.
    // Do NOT reset hasGreetedThisSession - greeting only plays once per session
    this.setState("connecting");
    const creds = await this.deps.tokenProvider().catch(() => null);
    if (this.stopped) return;
    if (!creds) {
      this.shutdown();
      this.callbacks.onGiveUp("Live voice is unavailable right now.");
      return;
    }
    await this.connect(creds.token, creds.model, this.language);
  }

  private reconnectSoon(): void {
    if (this.stopped || this.state === "reconnecting") return;
    this.onTransportLost("Live voice session is rotating.");
  }

  /** Pause streaming (tab hidden): full transport teardown, mic released,
   *  pending reconnects cancelled. Resume with start() — mic permission
   *  persists, so this is silent. */
  suspend(): void {
    if (this.reconnectHandle != null) {
      this.deps.cancel(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.isPlayingModelAudio) {
      this.isPlayingModelAudio = false;
      this.engine?.setMuted(false);
    }
    this.teardownTransport();
    if (!this.stopped && this.state !== "ended" && this.state !== "error") this.setState("idle");
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectHandle != null) {
      this.deps.cancel(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.isPlayingModelAudio) {
      this.isPlayingModelAudio = false;
      this.engine?.setMuted(false);
    }
    this.clearSetupTimeout();
    this.teardownTransport();
    this.setState("ended");
  }

  private teardownTransport(): void {
    this.clearSetupTimeout();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Best-effort.
      }
    }
    const engine = this.engine;
    this.engine = null;
    if (engine) {
      try {
        engine.stop();
      } catch {
        // Best-effort.
      }
    }
    const mic = this.mic;
    this.mic = null;
    this.micStreamForHost = null;
    if (mic) {
      try {
        mic.stop();
      } catch {
        // Best-effort.
      }
    }
    this.setupDone = false;
  }

  private shutdown(): void {
    this.teardownTransport();
    this.setState("ended");
  }
}
