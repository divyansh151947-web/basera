import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildLiveSetup,
  buildLiveTools,
  buildToolResponse,
  bytesToBase64,
  downsampleToPcm16,
  frameToText,
  LIVE_DEFAULT_MODEL,
  liveModelId,
  LiveVoiceSession,
  parseLiveServerMessage,
  type LiveSocket,
} from "./live-voice-session";
import { PcmPlayer, type PcmPlayerContext } from "./live-audio";
import type { VoiceLanguage } from "./voice-provider";

describe("live PCM + setup helpers (pure)", () => {
  it("downsamples 48 kHz float to 16 kHz int16 without clipping", () => {
    const input = new Float32Array([0, 0.5, 1, -1, 2, -2, 0.25, -0.25, 0]);
    const out = downsampleToPcm16(input, 48000);
    expect(out.length).toBe(3);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(-32768);
    expect(out[2]).toBeGreaterThan(0);
    expect(downsampleToPcm16(new Float32Array([5, 0, 0, 0, 0, 0]), 48000)[0]).toBe(32767);
    expect(downsampleToPcm16(new Float32Array([-5, 0, 0, 0, 0, 0]), 48000)[0]).toBe(-32768);
    expect(downsampleToPcm16(new Float32Array(0), 48000).length).toBe(0);
    expect(downsampleToPcm16(new Float32Array([0.5]), 0).length).toBe(0);
  });

  it("base64-encodes large buffers without stack blowup", () => {
    const bytes = new Uint8Array(100000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
    expect(Buffer.from(bytesToBase64(bytes), "base64")).toEqual(Buffer.from(bytes));
  });

  it("builds the audio-to-audio setup frame (model, AUDIO, VAD, tools, transcriptions)", () => {
    const setup = buildLiveSetup("models/x", "hinglish") as {
      setup: {
        model: string;
        generationConfig: { responseModalities: string[] };
        systemInstruction: { parts: Array<{ text: string }> };
        tools: unknown[];
        realtimeInputConfig: {
          automaticActivityDetection: {
            startSensitivity: string;
            endSensitivity: string;
            prefixPaddingMs: number;
            silenceDurationMs: number;
          };
        };
        inputAudioTranscription: object;
        outputAudioTranscription: object;
      };
    };
    expect(setup.setup.model).toBe("models/x");
    expect(setup.setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(setup.setup.systemInstruction.parts[0].text).toMatch(/Hinglish/);
    expect(setup.setup.tools).toHaveLength(1);
    expect(setup.setup.realtimeInputConfig.automaticActivityDetection.startSensitivity).toBe(
      "START_SENSITIVITY_HIGH"
    );
    expect(setup.setup.realtimeInputConfig.automaticActivityDetection.endSensitivity).toBe(
      "END_SENSITIVITY_HIGH"
    );
    expect(setup.setup.realtimeInputConfig.automaticActivityDetection.prefixPaddingMs).toBe(300);
    expect(setup.setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBe(1000);
    expect(setup.setup.inputAudioTranscription).toEqual({});
    expect(setup.setup.outputAudioTranscription).toEqual({});
  });

  it("declares the basera_reply tool with an exact-transcript argument", () => {
    const tools = buildLiveTools() as {
      functionDeclarations: Array<{ name: string; parameters: { required: string[] } }>;
    };
    expect(tools.functionDeclarations[0].name).toBe("basera_reply");
    expect(tools.functionDeclarations[0].parameters.required).toEqual(["transcript"]);
    const response = buildToolResponse("call-1", "Hello") as {
      toolResponse: { functionResponses: Array<{ id: string; name: string; response: { reply: string } }> };
    };
    expect(response.toolResponse.functionResponses[0]).toEqual({
      id: "call-1",
      name: "basera_reply",
      response: { reply: "Hello" },
    });
  });

  it("defaults to the verified Live model, overridable by env", () => {
    expect(LIVE_DEFAULT_MODEL).toBe("models/gemini-2.5-flash-native-audio-latest");
    expect(liveModelId({})).toBe(LIVE_DEFAULT_MODEL);
    expect(liveModelId({ GEMINI_LIVE_MODEL: "  models/custom  " })).toBe("models/custom");
  });

  it("decodes binary frames as UTF-8 text (setupComplete arrives binary live)", () => {
    expect(frameToText('{"a":1}')).toBe('{"a":1}');
    const bytes = new TextEncoder().encode('{"setupComplete":{}}');
    expect(frameToText(new Uint8Array(bytes))).toBe('{"setupComplete":{}}');
    expect(frameToText(new Uint8Array(bytes).buffer)).toBe('{"setupComplete":{}}');
    expect(frameToText(null)).toBeNull();
    expect(frameToText(42)).toBeNull();
  });

  it("parses server messages defensively (never throws, never invents text)", () => {
    expect(parseLiveServerMessage({ setupComplete: {} })).toEqual([{ kind: "setup-complete" }]);
    expect(
      parseLiveServerMessage({ serverContent: { inputTranscription: { text: "  hi  " }, turnComplete: true } })
    ).toEqual([
      { kind: "input-transcript", text: "hi", final: true },
      { kind: "turn-complete" },
    ]);
    expect(parseLiveServerMessage({ serverContent: { inputTranscription: { text: "partial" } } })).toEqual([
      { kind: "input-transcript", text: "partial", final: false },
    ]);
    expect(parseLiveServerMessage({ serverContent: { outputTranscription: { text: "spoken" } } })).toEqual([
      { kind: "output-transcript", text: "spoken" },
    ]);
    expect(
      parseLiveServerMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD", mimeType: "audio/pcm" } }] } } })
    ).toEqual([{ kind: "model-audio", base64: "QUJD" }]);
    expect(
      parseLiveServerMessage({ toolCall: { functionCalls: [{ id: "c1", name: "basera_reply", args: { transcript: "hi" } }] } })
    ).toEqual([{ kind: "tool-call", id: "c1", transcript: "hi" }]);
    expect(
      parseLiveServerMessage({ toolCall: { functionCalls: [{ id: "c2", name: "other_tool", args: {} }] } })
    ).toEqual([{ kind: "unknown" }]);
    expect(parseLiveServerMessage({ serverContent: { interrupted: true } })).toEqual([{ kind: "interrupted" }]);
    expect(parseLiveServerMessage({ serverContent: { turnComplete: true } })).toEqual([{ kind: "turn-complete" }]);
    expect(parseLiveServerMessage({ goAway: { timeLeft: "12.5s" } })).toEqual([
      { kind: "go-away", timeLeftSeconds: 12.5 },
    ]);
    expect(parseLiveServerMessage(null)).toEqual([{ kind: "unknown" }]);
    expect(parseLiveServerMessage({ serverContent: { modelTurn: {} } })).toEqual([{ kind: "unknown" }]);
  });
});

/** Deterministic fakes: scripted socket + mic + PCM tap. */
function makeFakes() {
  const sockets: FakeSocket[] = [];
  const sent: string[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const h = {
    sockets,
    sent,
    timers,
    token: "tok-1",
    model: "models/test-live",
    micStops: 0,
    states: [] as string[],
    transcripts: [] as string[],
    spoken: [] as string[],
    audioChunks: [] as string[],
    toolCalls: [] as Array<{ id: string; transcript: string }>,
    interrupts: 0,
    turnCompletions: 0,
    giveUps: [] as string[],
    runTimers() {
      const pending = h.timers.splice(0);
      for (const t of pending) t.fn();
    },
  };
  class FakeSocket implements LiveSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    closed = false;
    constructor(public url: string) {
      sockets.push(this);
    }
    send(data: string) {
      sent.push(data);
    }
    close() {
      this.closed = true;
    }
    emit(data: unknown) {
      // Mirror the wire: objects go out as JSON text like a real socket.
      this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
    }
    emitBinary(json: string) {
      this.onmessage?.({ data: new TextEncoder().encode(json).buffer });
    }
    fail() {
      this.onerror?.();
    }
    drop(code = 1006) {
      this.onclose?.({ code, reason: "" });
    }
  }
  const deps = {
    socketFactory: (url: string) => new FakeSocket(url),
    micFactory: async () => {
      let stopped = false;
      return {
        stream: { id: "mic-stream" },
        stop: () => {
          if (!stopped) {
            stopped = true;
            h.micStops += 1;
          }
        },
      };
    },
    audioFactory: () => ({
      start: async () => undefined,
      stop: () => undefined,
      setMuted: () => undefined,
    }),
    tokenProvider: async (): Promise<{ token: string; model: string } | null> => ({ token: h.token, model: h.model }),
    schedule: (fn: () => void, ms: number) => {
      const handle = { fn, ms };
      timers.push(handle);
      return handle;
    },
    cancel: (handle: unknown) => {
      const i = timers.indexOf(handle as { fn: () => void; ms: number });
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const callbacks = {
    onState: (s: string) => h.states.push(s),
    onFinalTranscript: (t: string) => h.transcripts.push(t),
    onAssistantTranscript: (t: string) => h.spoken.push(t),
    onModelAudio: (b: string) => h.audioChunks.push(b),
    onToolCall: (id: string, t: string) => h.toolCalls.push({ id, transcript: t }),
    onTurnComplete: () => {
      h.turnCompletions += 1;
    },
    onInterrupted: () => {
      h.interrupts += 1;
    },
    onGiveUp: (m: string) => h.giveUps.push(m),
  };
  return { h, deps, callbacks, FakeSocket };
}

describe("LiveVoiceSession audio-to-audio (fake transport)", () => {
  it("connects with the token URL, sends setup, reaches listening (binary setupComplete works)", async () => {
    const { h, deps, callbacks } = makeFakes();
    const session = new LiveVoiceSession(deps, callbacks, { maxReconnects: 0 });
    await session.start("en");
    expect(h.states).toEqual(["connecting"]);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].url).toContain("access_token=tok-1");
    h.sockets[0].onopen?.();
    const setup = JSON.parse(h.sent[0]) as { setup: { model: string } };
    expect(setup.setup.model).toBe("models/test-live");
    // Binary setupComplete (as observed live) must also work.
    h.sockets[0].emitBinary('{"setupComplete":{}}');
    expect(h.states).toEqual(["connecting", "listening"]);
    expect(session.getState()).toBe("listening");
    session.stop();
    expect(session.getState()).toBe("ended");
    expect(h.micStops).toBe(1);
  });

  it("full tool turn: transcript + tool call + spoken output, each exactly once", async () => {
    const { h, deps, callbacks } = makeFakes();
    const session = new LiveVoiceSession(deps, callbacks, { maxReconnects: 0 });
    await session.start("hi" as VoiceLanguage);
    h.sockets[0].onopen?.();
    h.sockets[0].emit({ setupComplete: {} });
    h.sockets[0].emit({ serverContent: { inputTranscription: { text: "namaste" }, turnComplete: true } });
    expect(h.transcripts).toEqual(["namaste"]);
    h.sockets[0].emit({ toolCall: { functionCalls: [{ id: "call-9", name: "basera_reply", args: { transcript: "namaste" } }] } });
    expect(h.toolCalls).toEqual([{ id: "call-9", transcript: "namaste" }]);
    h.sockets[0].emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD", mimeType: "audio/pcm" } }] } } });
    expect(h.audioChunks).toEqual(["QUJD"]);
    h.sockets[0].emit({ serverContent: { outputTranscription: { text: "Namaste! Kaise ho?" } } });
    expect(h.spoken).toEqual(["Namaste! Kaise ho?"]);
    h.sockets[0].emit({ serverContent: { turnComplete: true } });
    expect(h.turnCompletions).toBe(2); // one with the transcript, one standalone
    // Transport states stay clean: conversational states live in the host.
    // Now includes speaking state when model audio plays; turn-complete after transcript also emits listening
    expect(h.states).toEqual(["connecting", "listening", "listening", "speaking", "listening"]);
    session.stop();
  });

  it("interruption notifies the host; malformed frames never throw", async () => {
    const { h, deps, callbacks } = makeFakes();
    const session = new LiveVoiceSession(deps, callbacks, { maxReconnects: 0 });
    await session.start("en");
    h.sockets[0].onopen?.();
    h.sockets[0].emit({ setupComplete: {} });
    h.sockets[0].emit({ serverContent: { interrupted: true } });
    expect(h.interrupts).toBe(1);
    expect(h.states).toContain("listening");
    const onmessage = h.sockets[0].onmessage as (e: { data: unknown }) => void;
    expect(() => onmessage({ data: new Uint8Array([1, 2, 3]) })).not.toThrow();
    expect(() => onmessage({ data: "{oops" })).not.toThrow();
    expect(() => onmessage({ data: null })).not.toThrow();
    session.stop();
  });

  it("failed token gives up to the fallback path (same session)", async () => {
    const { h, deps, callbacks } = makeFakes();
    deps.tokenProvider = async () => null;
    const session = new LiveVoiceSession(deps, callbacks, { maxReconnects: 0 });
    await session.start("en");
    expect(h.giveUps).toHaveLength(1);
    expect(h.sockets).toHaveLength(0);
    expect(session.getState()).toBe("ended");
  });

  it("dropped transport reconnects with a fresh token, then gives up", async () => {
    const { h, deps, callbacks } = makeFakes();
    const session = new LiveVoiceSession(deps, callbacks, { maxReconnects: 1 });
    await session.start("en");
    h.sockets[0].onopen?.();
    h.sockets[0].emit({ setupComplete: {} });
    expect(h.states).toContain("listening");
    h.token = "tok-2";
    h.sockets[0].drop();
    expect(h.states).toContain("reconnecting");
    h.runTimers();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1].url).toContain("access_token=tok-2");
    h.sockets[1].drop();
    h.runTimers();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.giveUps).toHaveLength(1);
    expect(h.micStops).toBeGreaterThanOrEqual(1);
    expect(session.getState()).toBe("ended");
  });

  it("stop() tears down socket, engine, and mic exactly once each", async () => {
    const { h, deps, callbacks } = makeFakes();
    const session = new LiveVoiceSession(deps, callbacks, { maxReconnects: 0 });
    await session.start("en");
    h.sockets[0].onopen?.();
    h.sockets[0].emit({ setupComplete: {} });
    session.stop();
    session.stop();
    expect(h.sockets[0].closed).toBe(true);
    expect(h.micStops).toBe(1);
    expect(h.states[h.states.length - 1]).toBe("ended");
  });
});

describe("PcmPlayer gapless queue (stub audio context)", () => {
  function stubContext() {
    type StubSource = {
      buffer: { getChannelData: (c: number) => Float32Array } | null;
      startedAt: number | null;
      stopped: boolean;
      onended: unknown;
      connect: () => void;
      disconnect: () => void;
      start: (when?: number) => void;
      stop: () => void;
    };
    const sources: StubSource[] = [];
    const ctx: PcmPlayerContext = {
      currentTime: 100,
      sampleRate: 48000,
      createBuffer: (_channels: number, length: number, _rate: number) => {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
      },
      createBufferSource: () => {
        const source: StubSource = {
          buffer: null,
          startedAt: null,
          stopped: false,
          onended: null,
          connect: () => undefined,
          disconnect: () => undefined,
          start: (when?: number) => {
            source.startedAt = when ?? 0;
          },
          stop: () => {
            source.stopped = true;
          },
        };
        sources.push(source);
        return source;
      },
      destination: {},
      resume: async () => undefined,
      close: async () => undefined,
    };
    return { ctx, sources };
  }

  const decode = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

  it("queues chunks gaplessly starting immediately", () => {
    const { ctx, sources } = stubContext();
    const player = new PcmPlayer(ctx, decode);
    const pcm = new Int16Array([1000, -1000, 2000, -2000]);
    player.queueBase64(Buffer.from(pcm.buffer).toString("base64"));
    player.queueBase64(Buffer.from(pcm.buffer).toString("base64"));
    expect(sources).toHaveLength(2);
    expect(sources[0].startedAt).toBeCloseTo(100.02, 5);
    // Second chunk chains exactly after the first (4 samples @24 kHz).
    expect(sources[1].startedAt).toBeCloseTo(100.02 + 4 / 24000, 5);
    expect(player.isPlaying()).toBe(true);
    player.dispose();
    expect(player.isPlaying()).toBe(false);
  });

  it("stopAndClear silences immediately and fires drain on natural end", () => {
    const { ctx, sources } = stubContext();
    const player = new PcmPlayer(ctx, decode);
    let drained = 0;
    player.onDrained = () => {
      drained += 1;
    };
    const pcm = new Int16Array([100, 200]);
    player.queueBase64(Buffer.from(pcm.buffer).toString("base64"));
    expect(player.isPlaying()).toBe(true);
    player.stopAndClear();
    expect(player.isPlaying()).toBe(false);
    expect(sources[0].stopped).toBe(true);
    expect(drained).toBe(0);
    player.queueBase64(Buffer.from(pcm.buffer).toString("base64"));
    const onended = sources[1].onended as (() => void) | null;
    onended?.();
    expect(drained).toBe(1);
    player.dispose();
  });

  it("turnComplete arrives with transcripts (both events fire)", async () => {
    const { h, deps, callbacks } = makeFakes();
    const session = new LiveVoiceSession(deps, callbacks, { maxReconnects: 0 });
    await session.start("en");
    h.sockets[0].onopen?.();
    h.sockets[0].emit({ setupComplete: {} });
    h.sockets[0].emit({ serverContent: { inputTranscription: { text: "hi" }, turnComplete: true } });
    // Transcript AND turn-complete both surface (widget finalizes once).
    expect(h.transcripts).toEqual(["hi"]);
    expect(h.turnCompletions).toBe(1);
    session.stop();
  });

  it("ignores garbage without throwing", () => {
    const { ctx } = stubContext();
    const player = new PcmPlayer(ctx, decode);
    expect(() => {
      player.queueBase64("");
      player.queueBase64("!!!");
      player.stopAndClear();
      player.dispose();
      player.queueBase64("QUJD");
    }).not.toThrow();
    expect(player.isPlaying()).toBe(false);
  });
});
