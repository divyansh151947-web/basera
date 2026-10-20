import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  toVoiceLoopError,
  VoiceLoopController,
  type PlayerHandle,
  type RecordedAudio,
  type RecorderLike,
  type TurnResult,
  type VoiceLoopDeps,
  type VoiceLoopOptions,
  type VoiceLoopState,
} from "./voice-loop-controller";

/** Deterministic driver: scripted mic energy, manual clock + ticks. */
class Harness {
  states: VoiceLoopState[] = [];
  errors: { code: string; message: string }[] = [];
  transcripts: string[] = [];
  replies: string[] = [];
  sendTurnCalls: { audio: { base64: string; mimeType: string; speechMs: number } | null; text: string }[] = [];
  sendTurnImpl: (audio: { base64: string; mimeType: string; speechMs: number } | null, text: string) => Promise<TurnResult> =
    async () => ({ reply: "Understood.", replyAudioBase64: "AAA=", replyAudioMimeType: "audio/mpeg", transcript: null });
  playCalls: { base64: string; mime: string }[] = [];
  activePlayers = 0;
  maxActivePlayers = 0;
  playEndHandlers: (() => void)[] = [];
  speakTexts: string[] = [];
  greetCalls = 0;
  greetImpl: () => Promise<void> = async () => {
    this.greetCalls += 1;
  };
  micRequested = 0;
  micFail: Error | null = null;
  micGate: Promise<void> | null = null;
  recordersCreated = 0;
  deliverAudio: RecordedAudio | null = { base64: "dGVzdA==", mimeType: "audio/webm" };
  energy = 0;
  time = 1_000_000;
  tickFns: (() => void)[] = [];
  controller: VoiceLoopController;

  constructor(loopOpts: VoiceLoopOptions = {}) {
    const deps: VoiceLoopDeps = {
      requestMic: async () => {
        this.micRequested += 1;
        if (this.micFail) throw this.micFail;
        if (this.micGate) await this.micGate;
        return { stop: () => undefined };
      },
      createRecorder: (onStop, _onError) => {
        this.recordersCreated += 1;
        let done = false;
        const rec: RecorderLike = {
          state: "recording",
          stop: () => {
            if (done) return;
            done = true;
            onStop(this.deliverAudio);
          },
          setMuted: () => undefined,
        };
        return rec;
      },
      sampleEnergy: () => this.energy,
      sendTurn: async (audio, text) => {
        this.sendTurnCalls.push({ audio, text });
        return this.sendTurnImpl(audio, text);
      },
      playAudio: (base64, mime, onEnded, _onError) => {
        this.playCalls.push({ base64, mime });
        this.activePlayers += 1;
        this.maxActivePlayers = Math.max(this.maxActivePlayers, this.activePlayers);
        this.playEndHandlers.push(onEnded);
        const handle: PlayerHandle = {
          stop: () => {
            if (this.activePlayers > 0) this.activePlayers -= 1;
          },
        };
        return handle;
      },
      speakText: async (text) => {
        this.speakTexts.push(text);
      },
      speakGreeting: async () => {
        await this.greetImpl();
      },
      stopSpeaking: () => undefined,
      scheduleTick: (fn) => {
        this.tickFns.push(fn);
        return this.tickFns.length;
      },
      cancelTick: () => undefined,
      now: () => this.time,
      onState: (s) => {
        this.states.push(s);
      },
      onError: (code, message) => {
        this.errors.push({ code, message });
      },
      onTranscript: (t) => {
        this.transcripts.push(t);
      },
      onReply: (t) => {
        this.replies.push(t);
      },
    };
    this.controller = new VoiceLoopController(deps, {
      tickMs: 100,
      silenceMs: 500,
      minSpeechMs: 200,
      maxRecordMs: 5000,
      bargeInEnergy: 0.5,
      bargeInSustainMs: 200,
      ...loopOpts,
    });
  }

  tick() {
    for (const fn of this.tickFns) fn();
  }

  advance(ms: number) {
    this.time += ms;
    this.tick();
  }

  /** Simulate sustained speech for ms, then silence until the turn sends. */
  async speakThenSilence(speechMs: number, silenceMs = 800) {
    this.energy = 0.6;
    const steps = Math.ceil(speechMs / 100);
    for (let i = 0; i < steps; i += 1) this.advance(100);
    this.energy = 0;
    const silSteps = Math.ceil(silenceMs / 100);
    for (let i = 0; i < silSteps; i += 1) {
      this.advance(100);
      await Promise.resolve();
    }
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }

  endPlayback() {
    const handlers = this.playEndHandlers.splice(0);
    for (const h of handlers) h();
    this.activePlayers = 0;
  }
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("automatic voice loop (no manual Speak step)", () => {
  it("1. start() lands in listening with no further action", async () => {
    const h = new Harness();
    await h.controller.start();
    expect(h.controller.getState()).toBe("listening");
    expect(h.states).toEqual(["requesting-mic", "listening", "greeting", "listening"]);
    expect(h.micRequested).toBe(1);
    expect(h.recordersCreated).toBe(0);
    expect(h.greetCalls).toBe(1);
  });

  it("2/5/6. speech auto-sends one turn and the reply auto-plays", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.speakThenSilence(500);
    expect(h.sendTurnCalls).toHaveLength(1);
    expect(h.sendTurnCalls[0].audio).not.toBeNull();
    expect(h.replies).toEqual(["Understood."]);
    // No Speak action exists on the controller; playback started by itself.
    expect(!("speak" in h.controller) && !("play" in h.controller)).toBe(true);
    expect(h.playCalls).toHaveLength(1);
    expect(h.playCalls[0].base64).toBe("AAA=");
    expect(h.controller.getState()).toBe("speaking");
  });

  it("3/8. one recording produces exactly one turn (no duplicates)", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.speakThenSilence(900);
    expect(h.sendTurnCalls).toHaveLength(1);
    // Duplicate onEnded delivery changes nothing.
    h.endPlayback();
    h.endPlayback();
    expect(h.controller.getState()).toBe("listening");
    expect(h.sendTurnCalls).toHaveLength(1);
  });

  it("4. silence is never uploaded; short blips are discarded", async () => {
    const h = new Harness();
    await h.controller.start();
    for (let i = 0; i < 10; i += 1) h.advance(100);
    expect(h.recordersCreated).toBe(0);
    expect(h.sendTurnCalls).toHaveLength(0);
    // 100ms blip < 200ms minimum: recorder stops, nothing sent.
    h.energy = 0.6;
    h.advance(100);
    h.energy = 0;
    await h.speakThenSilence(0, 800);
    expect(h.sendTurnCalls).toHaveLength(0);
    expect(h.controller.getState()).toBe("listening");
  });

  it("7. after TTS ends, listening resumes and the loop continues", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.speakThenSilence(500);
    expect(h.controller.getState()).toBe("speaking");
    h.endPlayback();
    expect(h.controller.getState()).toBe("listening");
    await h.speakThenSilence(500);
    expect(h.sendTurnCalls).toHaveLength(2);
  });

  it("9. duplicate playback is prevented (previous player stopped)", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.speakThenSilence(500);
    h.endPlayback();
    await h.speakThenSilence(500);
    expect(h.playCalls).toHaveLength(2);
    expect(h.maxActivePlayers).toBe(1);
  });

  it("duplicate start() calls request the mic only once", async () => {
    const h = new Harness();
    await Promise.all([h.controller.start(), h.controller.start()]);
    expect(h.micRequested).toBe(1);
  });

  it("10. microphone denial lands in error with a clear message", async () => {
    const h = new Harness();
    const err = new Error("Permission dismissed");
    err.name = "NotAllowedError";
    h.micFail = err;
    await h.controller.start();
    expect(h.controller.getState()).toBe("error");
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].code).toBe("permission_denied");
    expect(h.errors[0].message).toMatch(/permission/i);
  });

  it("10b. missing microphone hardware is handled distinctly from denial", async () => {
    const h = new Harness();
    const err = new Error("No device");
    err.name = "NotFoundError";
    h.micFail = err;
    await h.controller.start();
    expect(h.controller.getState()).toBe("error");
    expect(h.errors[0].message).toMatch(/no microphone/i);
  });

  it("10c. occupied microphone explains the real problem", async () => {
    const h = new Harness();
    const err = new Error("Busy");
    err.name = "NotReadableError";
    h.micFail = err;
    await h.controller.start();
    expect(h.controller.getState()).toBe("error");
    expect(h.errors[0].message).toMatch(/already in use/i);
  });

  it("10d. unsatisfiable constraints and security blocks are explicit", async () => {
    const over = new Harness();
    const overErr = new Error("Constraints");
    overErr.name = "OverconstrainedError";
    over.micFail = overErr;
    await over.controller.start();
    expect(over.errors[0].message).toMatch(/constraints|satisfies the required/i);

    const sec = new Harness();
    const secErr = new Error("Blocked");
    secErr.name = "SecurityError";
    sec.micFail = secErr;
    await sec.controller.start();
    expect(sec.errors[0].code).toBe("permission_denied");
    expect(sec.errors[0].message).toMatch(/blocked|https/i);
  });

  it("11. provider/config failure surfaces provider_unavailable", async () => {
    const h = new Harness();
    h.sendTurnImpl = async () => {
      throw toVoiceLoopError(503, "Voice provider is not configured.");
    };
    await h.controller.start();
    await h.speakThenSilence(500);
    expect(h.controller.getState()).toBe("error");
    expect(h.errors[0].code).toBe("provider_unavailable");
  });

  it("transient failures (429/413) resume listening instead of ending", async () => {
    const h = new Harness();
    let calls = 0;
    h.sendTurnImpl = async () => {
      calls += 1;
      if (calls === 1) throw toVoiceLoopError(429, "Rate limited.");
      return { reply: "Back.", replyAudioBase64: null, replyAudioMimeType: null, transcript: null };
    };
    await h.controller.start();
    await h.speakThenSilence(500);
    expect(h.controller.getState()).toBe("listening");
    expect(h.errors[0].code).toBe("network_error");
    await h.speakThenSilence(500);
    expect(h.replies).toEqual(["Back."]);
  });

  it("barge-in stops playback on sustained speech and starts a new turn", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.speakThenSilence(500);
    expect(h.controller.getState()).toBe("speaking");
    // Loud sustained speech while AI talks: interrupt, then new turn.
    h.energy = 0.8;
    h.advance(100);
    h.advance(100);
    h.advance(100);
    expect(h.controller.getState()).toBe("listening");
    expect(h.activePlayers).toBe(0);
    await h.speakThenSilence(500);
    expect(h.sendTurnCalls).toHaveLength(2);
  });

  it("brief loud blips do not barge in", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.speakThenSilence(500);
    h.energy = 0.8;
    h.advance(100);
    h.energy = 0;
    h.advance(100);
    expect(h.controller.getState()).toBe("speaking");
  });

  it("VAD requires sustained energy: a single-tick spike starts no recording", async () => {
    const h = new Harness();
    await h.controller.start();
    h.energy = 0.6;
    h.advance(100);
    h.energy = 0;
    h.advance(100);
    expect(h.recordersCreated).toBe(0);
    expect(h.controller.getState()).toBe("listening");
    expect(h.sendTurnCalls).toHaveLength(0);
  });

  it("adaptive noise floor ignores sustained room hum but still hears speech", async () => {
    // Sensitive base on purpose: without adaptation, 0.03 room hum would
    // trigger recording immediately (0.03 > 0.02).
    const h = new Harness({ energyThreshold: 0.02 });
    await h.controller.start();
    h.energy = 0.03;
    for (let i = 0; i < 20; i += 1) h.advance(100);
    expect(h.recordersCreated).toBe(0);
    h.energy = 0.06;
    for (let i = 0; i < 40; i += 1) h.advance(100);
    expect(h.recordersCreated).toBe(1);
    // Advance silence to let the recording complete and the turn process
    for (let i = 0; i < 20; i += 1) h.advance(100);
    // The turn should complete and return to listening
    await h.speakThenSilence(500);
    expect(h.sendTurnCalls).toHaveLength(1);
  });

  it("typed fallback sends exactly one auto-played turn", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.controller.sendTypedTranscript("Hello typed");
    expect(h.sendTurnCalls).toHaveLength(1);
    expect(h.sendTurnCalls[0].text).toBe("Hello typed");
    expect(h.replies).toHaveLength(1);
  });

  it("chat sync: voice turn shows the server-confirmed transcript exactly once (never a placeholder)", async () => {
    const h = new Harness();
    h.sendTurnImpl = async () => ({
      reply: "Sure. What is your budget?",
      replyAudioBase64: "AAA=",
      replyAudioMimeType: "audio/mpeg",
      transcript: "I want a property in Gurgaon.",
    });
    await h.controller.start();
    await h.speakThenSilence(500);
    expect(h.transcripts).toEqual(["I want a property in Gurgaon."]);
    expect(h.replies).toEqual(["Sure. What is your budget?"]);
  });

  it("chat sync: typed turn shows the typed text exactly once", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.controller.sendTypedTranscript("80 lakh");
    expect(h.transcripts).toEqual(["80 lakh"]);
    expect(h.sendTurnCalls).toHaveLength(1);
  });

  it("chat sync: failed turn creates no user message and no assistant message", async () => {
    const h = new Harness();
    h.sendTurnImpl = async () => {
      throw toVoiceLoopError(500, "boom");
    };
    await h.controller.start();
    await h.speakThenSilence(500);
    expect(h.transcripts).toHaveLength(0);
    expect(h.replies).toHaveLength(0);
  });

  it("end() tears everything down exactly once", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.controller.end();
    await h.controller.end();
    expect(h.controller.getState()).toBe("ended");
  });
});

describe("toVoiceLoopError mapping", () => {
  it("maps statuses to codes with fatal flags", () => {
    expect(toVoiceLoopError(503, "x").code).toBe("provider_unavailable");
    expect(toVoiceLoopError(503, "x").fatal).toBe(true);
    expect(toVoiceLoopError(429, "x").fatal).toBe(false);
    expect(toVoiceLoopError(413, "x").fatal).toBe(false);
    expect(toVoiceLoopError(null, "transcription blew up").code).toBe("stt_error");
    expect(toVoiceLoopError(null, "synthesis blew up").code).toBe("tts_error");
    expect(toVoiceLoopError(null, "socket hang up").code).toBe("network_error");
  });
});

describe("automatic greeting", () => {
  it("greeting plays exactly once per start, then listening resumes", async () => {
    const h = new Harness();
    await h.controller.start();
    expect(h.greetCalls).toBe(1);
    expect(h.states).toContain("greeting");
    expect(h.controller.getState()).toBe("listening");
  });

  it("greeting TTS failure still reaches listening (never wedged)", async () => {
    const h = new Harness();
    h.greetImpl = async () => {
      throw new Error("TTS exploded");
    };
    await h.controller.start();
    expect(h.greetCalls).toBe(0);
    expect(h.controller.getState()).toBe("listening");
  });

  it("greeting never repeats on the same controller", async () => {
    const h = new Harness();
    await h.controller.start();
    await h.controller.greet();
    await h.controller.greet();
    expect(h.greetCalls).toBe(1);
  });

  it("no greeting after end()", async () => {
    const h = new Harness();
    await h.controller.start();
    const calls = h.greetCalls;
    await h.controller.end();
    await h.controller.greet();
    expect(h.greetCalls).toBe(calls);
    expect(h.controller.getState()).toBe("ended");
  });
});

describe("text-only start (no microphone)", () => {
  it("starts listening without requesting the mic; typed turns auto-play", async () => {
    const h = new Harness();
    await h.controller.startTextOnly();
    expect(h.micRequested).toBe(0);
    expect(h.controller.getState()).toBe("listening");
    expect(h.greetCalls).toBe(1);
    await h.controller.sendTypedTranscript("Hello typed");
    expect(h.sendTurnCalls).toHaveLength(1);
    expect(h.replies).toEqual(["Understood."]);
    expect(h.playCalls).toHaveLength(1);
  });

  it("duplicate starts (voice or text) do not duplicate work", async () => {
    const h = new Harness();
    await Promise.all([h.controller.start(), h.controller.startTextOnly()]);
    expect(h.micRequested).toBeLessThanOrEqual(1);
    expect(h.greetCalls).toBeLessThanOrEqual(1);
  });
});
