import { describe, expect, it, vi } from "vitest";
import { VoiceLoopController, toVoiceLoopError, type VoiceLoopDeps } from "./voice-loop-controller";

/** Minimal valid WAV header + one sample (audible-length not required for
 *  controller-level tests; WavPlayer structure tests live in wav-player.test.ts). */
const WAV_B64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAA=";

type ReplyOverride = () => Partial<{
  reply: string;
  replyAudioBase64: string | null;
  replyAudioMimeType: string | null;
  transcript: string | null;
}>;

function makeDeps(overrides: {
  playAudio?: VoiceLoopDeps["playAudio"];
  sendTurn?: VoiceLoopDeps["sendTurn"];
  speakText?: VoiceLoopDeps["speakText"];
  speakGreeting?: VoiceLoopDeps["speakGreeting"];
  createRecorder?: VoiceLoopDeps["createRecorder"];
  sampleEnergy?: VoiceLoopDeps["sampleEnergy"];
  scheduleTick?: VoiceLoopDeps["scheduleTick"];
  cancelTick?: VoiceLoopDeps["cancelTick"];
} = {}) {
  const errors: { code: string; message: string }[] = [];
  const states: string[] = [];
  const transcripts: string[] = [];
  const replies: string[] = [];
  const speakTexts: string[] = [];
  let greetCalls = 0;
  let turn = 0;

  const deps = {
    requestMic: async () => ({ stop: () => undefined }),
    createRecorder:
      overrides.createRecorder ??
      (() => ({ state: "recording" as const, stop: () => undefined, setMuted: () => undefined })),
    sampleEnergy: overrides.sampleEnergy ?? (() => 0),
    scheduleTick: overrides.scheduleTick ?? (() => 1),
    cancelTick: overrides.cancelTick ?? (() => undefined),
    sendTurn:
      overrides.sendTurn ??
      (async () => {
        turn += 1;
        return {
          reply: `Reply ${turn}`,
          replyAudioBase64: WAV_B64,
          replyAudioMimeType: "audio/wav",
          transcript: null,
        };
      }),
    playAudio:
      overrides.playAudio ??
      ((_b: string, _m: string, onEnded: () => void) => {
        setTimeout(onEnded, 5);
        return { stop: () => undefined };
      }),
    speakText:
      overrides.speakText ??
      (async (text: string) => {
        speakTexts.push(text);
      }),
    speakGreeting:
      overrides.speakGreeting ??
      (async () => {
        greetCalls += 1;
      }),
    stopSpeaking: () => undefined,
    now: () => Date.now(),
    onState: (s: string) => states.push(s),
    onError: (code: string, message: string) => errors.push({ code, message }),
    onTranscript: (t: string) => transcripts.push(t),
    onReply: (t: string) => replies.push(t),
  } satisfies VoiceLoopDeps;

  const controller = new VoiceLoopController(deps, { tickMs: 100, silenceMs: 500, minSpeechMs: 200 });
  return {
    controller,
    errors,
    states,
    transcripts,
    replies,
    speakTexts,
    get greetCalls() {
      return greetCalls;
    },
  };
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("voice audio — autoplay rejection recovery", () => {
  it("blocked reply playback is observed as an error and the loop resumes listening", async () => {
    const h = makeDeps({
      playAudio: (_b, _m, _onEnded, onError) => {
        const err = new Error("Audio playback was blocked by the browser.");
        err.name = "NotAllowedError";
        setTimeout(() => onError(err), 5);
        return { stop: () => undefined };
      },
    });
    await h.controller.start();
    await h.controller.sendTypedTranscript("hello");
    await settle();
    expect(h.replies).toEqual(["Reply 1"]);
    // Blocked playback must not wedge the loop: listening resumes.
    expect(h.controller.getState()).toBe("listening");
    // And the next turn still works.
    await h.controller.sendTypedTranscript("again");
    await settle();
    expect(h.replies).toEqual(["Reply 1", "Reply 2"]);
  });

  it("playAudio throwing synchronously still recovers to listening", async () => {
    const h = makeDeps({
      playAudio: () => {
        throw new Error("boom");
      },
    });
    await h.controller.start();
    await h.controller.sendTypedTranscript("hello");
    await settle();
    expect(h.controller.getState()).toBe("listening");
    expect(h.replies).toHaveLength(1);
  });
});

describe("voice audio — empty audio and TTS failures", () => {
  it("null reply audio falls back to the text speaker (never silent)", async () => {
    const h = makeDeps({
      sendTurn: async () => ({
        reply: "Spoken by fallback.",
        replyAudioBase64: null,
        replyAudioMimeType: null,
        transcript: null,
      }),
    });
    await h.controller.start();
    await h.controller.sendTypedTranscript("hello");
    await settle();
    expect(h.speakTexts).toEqual(["Spoken by fallback."]);
    expect(h.controller.getState()).toBe("listening");
  });

  it("recoverable TTS server errors resume listening and keep the conversation alive", async () => {
    let call = 0;
    const h = makeDeps({
      sendTurn: async () => {
        call += 1;
        if (call === 1) throw toVoiceLoopError(503, "Voice TTS failed.", "tts_error");
        return { reply: "Back.", replyAudioBase64: WAV_B64, replyAudioMimeType: "audio/wav", transcript: null };
      },
    });
    await h.controller.start();
    await h.controller.sendTypedTranscript("hello");
    await settle();
    expect(h.errors[0].code).toBe("tts_error");
    expect(h.controller.getState()).toBe("listening");
    await h.controller.sendTypedTranscript("hello again");
    await settle();
    expect(h.replies).toEqual(["Back."]);
  });
});

describe("voice audio — greeting", () => {
  it("a slow greeting is awaited exactly once and then listening resumes", async () => {
    let resolved = false;
    let calls = 0;
    const h = makeDeps({
      speakGreeting: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        resolved = true;
      },
    });
    await h.controller.start();
    expect(resolved).toBe(true);
    expect(calls).toBe(1);
    expect(h.controller.getState()).toBe("listening");
  });

  it("a greeting that rejects does not wedge the session", async () => {
    const h = makeDeps({
      speakGreeting: async () => {
        throw new Error("greeting fetch failed");
      },
    });
    await h.controller.start();
    expect(h.controller.getState()).toBe("listening");
    expect(h.errors).toHaveLength(0);
  });
});

describe("voice audio — listening-loop recovery after playback problems", () => {
  it("a voice turn whose playback errors returns to listening and the next voice turn plays", async () => {
    let playCall = 0;
    const h = makeDeps({
      playAudio: (_b, _m, onEnded, onError) => {
        playCall += 1;
        if (playCall === 1) {
          const err = new Error("Audio playback was blocked by the browser.");
          err.name = "NotAllowedError";
          setTimeout(() => onError(err), 5);
        } else {
          setTimeout(onEnded, 5);
        }
        return { stop: () => undefined };
      },
    });
    await h.controller.start();
    await settle();
    await h.controller.sendTypedTranscript("first");
    await settle(40);
    expect(h.controller.getState()).toBe("listening");
    await h.controller.sendTypedTranscript("second");
    await settle(40);
    expect(h.replies).toEqual(["Reply 1", "Reply 2"]);
    expect(playCall).toBe(2);
  });

  it("duplicate onEnded deliveries cannot double-advance the loop", async () => {
    const endedHandlers: (() => void)[] = [];
    const h = makeDeps({
      playAudio: (_b, _m, onEnded) => {
        endedHandlers.push(onEnded);
        return { stop: () => undefined };
      },
    });
    await h.controller.start();
    await h.controller.sendTypedTranscript("one");
    await settle();
    expect(h.controller.getState()).toBe("speaking");
    endedHandlers[0]();
    endedHandlers[0]();
    expect(h.controller.getState()).toBe("listening");
  });
});

describe("voice audio — greeting then replies (mobile conversation sequence)", () => {
  it("greeting plays first, then the first reply's own audio plays and listening resumes", async () => {
    const heard: string[] = [];
    const h = makeDeps({
      speakGreeting: async () => {
        heard.push("greeting");
      },
      playAudio: (_b, _m, onEnded) => {
        heard.push("reply-audio");
        setTimeout(onEnded, 5);
        return { stop: () => undefined };
      },
    });
    await h.controller.start();
    expect(heard).toEqual(["greeting"]);
    await h.controller.sendTypedTranscript("hello");
    await settle();
    expect(heard).toEqual(["greeting", "reply-audio"]);
    expect(h.replies).toEqual(["Reply 1"]);
    expect(h.controller.getState()).toBe("listening");
  });

  it("two consecutive replies each play their own payload — no mixing, no stale playback", async () => {
    let turn = 0;
    const heard: string[] = [];
    const h = makeDeps({
      sendTurn: async () => {
        turn += 1;
        return {
          reply: `Reply ${turn}`,
          replyAudioBase64: `REPLY_AUDIO_${turn}`,
          replyAudioMimeType: "audio/wav",
          transcript: null,
        };
      },
      playAudio: (b, _m, onEnded) => {
        heard.push(b);
        setTimeout(onEnded, 5);
        return { stop: () => undefined };
      },
    });
    await h.controller.start();
    await h.controller.sendTypedTranscript("first question");
    await settle(40);
    expect(h.controller.getState()).toBe("listening");
    await h.controller.sendTypedTranscript("second question");
    await settle(40);
    // Each reply plays exactly its own audio, in order, exactly once.
    expect(heard).toEqual(["REPLY_AUDIO_1", "REPLY_AUDIO_2"]);
    expect(h.replies).toEqual(["Reply 1", "Reply 2"]);
    expect(h.controller.getState()).toBe("listening");
  });

  it("a spoken question after the greeting auto-plays its reply without extra taps", async () => {
    let onStopCallback: ((audio: { base64: string; mimeType: string } | null) => void) | null = null;
    let energy = 0;
    const heard: string[] = [];
    const h = makeDeps({
      speakGreeting: async () => {
        heard.push("greeting");
      },
      sampleEnergy: () => energy,
      scheduleTick: (fn, ms) => setInterval(fn, ms),
      cancelTick: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      createRecorder: (onStop) => {
        onStopCallback = onStop;
        return {
          state: "recording" as const,
          stop: () => onStop({ base64: "RECORDED_SPEECH", mimeType: "audio/webm" }),
          setMuted: () => undefined,
        };
      },
      playAudio: (_b, _m, onEnded) => {
        heard.push("reply-audio");
        setTimeout(onEnded, 5);
        return { stop: () => undefined };
      },
    });
    await h.controller.start();
    expect(heard).toEqual(["greeting"]);
    // Sustained speech: VAD starts recording and accumulates speech time.
    energy = 0.1;
    await settle(650);
    expect(h.controller.getState()).toBe("recording");
    // Silence ends the turn; the recorded clip is sent and the reply plays.
    energy = 0;
    await settle(700);
    expect(onStopCallback).not.toBeNull();
    expect(heard).toEqual(["greeting", "reply-audio"]);
    expect(h.replies).toEqual(["Reply 1"]);
    expect(h.controller.getState()).toBe("listening");
  });

  it("the listening loop's ticks never interrupt an in-flight reply (no spurious stop)", async () => {
    let stopped = 0;
    const playback: { end: (() => void) | null } = { end: null };
    const h = makeDeps({
      sampleEnergy: () => 0.1, // audible speech level, but below barge-in (0.25)
      scheduleTick: (fn, ms) => setInterval(fn, ms),
      cancelTick: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      playAudio: (_b, _m, onEnded) => {
        playback.end = onEnded;
        return {
          stop: () => {
            stopped += 1;
          },
        };
      },
    });
    await h.controller.start();
    await h.controller.sendTypedTranscript("hello");
    await settle(400); // several loop ticks while the reply is playing
    expect(h.controller.getState()).toBe("speaking");
    expect(stopped).toBe(0); // the loop never killed the playback
    expect(typeof playback.end).toBe("function");
    playback.end?.();
    expect(h.controller.getState()).toBe("listening");
  });
});
