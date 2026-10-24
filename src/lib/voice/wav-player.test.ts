import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectWav, isAutoplayBlockedError, WavPlayer } from "./wav-player";

/** Build a valid mono 16-bit PCM WAV with the given payload size. */
function makeWav(dataBytes: number): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes);
  const writeAscii = (start: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[start + i] = text.charCodeAt(i);
  };
  const view = new DataView(bytes.buffer);
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const WAV_OK = toB64(makeWav(48000)); // 1 second @ 24 kHz
const WAV_NO_DATA = (() => {
  const bytes = makeWav(0);
  return toB64(bytes);
})();

/** Scriptable Audio() stand-in for the element fallback path. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  static playResult: "resolve" | "reject-blocked" | "reject-other" = "resolve";
  src = "";
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    if (FakeAudio.playResult === "reject-blocked") {
      const err = new Error("The request is not allowed by the user agent.");
      err.name = "NotAllowedError";
      return Promise.reject(err);
    }
    if (FakeAudio.playResult === "reject-other") return Promise.reject(new Error("network"));
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  /** Test helper: simulate natural end of playback. */
  finish(): void {
    this.onended?.();
  }
}

/** Minimal AudioContext for the Web Audio path. */
class FakeAudioContext {
  state = "running";
  destination = {};
  created: FakeBufferSource[] = [];
  decodeAudioData(): Promise<{ duration: number }> {
    return Promise.resolve({ duration: 1.25 });
  }
  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.created.push(source);
    return source;
  }
}

class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): void {}
  disconnect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

let revokedUrls: string[] = [];

beforeEach(() => {
  FakeAudio.instances = [];
  FakeAudio.playResult = "resolve";
  revokedUrls = [];
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => `blob:fake-${FakeAudio.instances.length}-${Math.random()}`,
    revokeObjectURL: (url: string) => {
      revokedUrls.push(url);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inspectWav — structural validation", () => {
  it("accepts a well-formed WAV and reports its duration", () => {
    const info = inspectWav(makeWav(48000));
    expect(info.valid).toBe(true);
    expect(info.durationMs).toBe(1000);
  });

  it("rejects a zero-data WAV (TTS returned header-only bytes)", () => {
    expect(inspectWav(makeWav(0)).valid).toBe(false);
  });

  it("rejects non-WAVE payloads shorter than a header", () => {
    expect(inspectWav(new Uint8Array(10)).valid).toBe(false);
  });
});

describe("isAutoplayBlockedError", () => {
  it("classifies NotAllowedError and user-gesture messages as blocked", () => {
    const err = new Error("play() failed because the user didn't interact");
    err.name = "NotAllowedError";
    expect(isAutoplayBlockedError(err)).toBe(true);
    expect(isAutoplayBlockedError(new Error("Playback was blocked by the browser"))).toBe(true);
    expect(isAutoplayBlockedError(new Error("decode failed"))).toBe(false);
    expect(isAutoplayBlockedError("not an error")).toBe(false);
  });
});

describe("WavPlayer — validation before playback", () => {
  it("rejects empty base64 with EmptyAudioError and never touches the audio element", async () => {
    const player = new WavPlayer({ onEnded: () => {}, onError: () => {} });
    await expect(player.play("")).rejects.toMatchObject({ name: "EmptyAudioError" });
    await expect(player.play("   ")).rejects.toMatchObject({ name: "EmptyAudioError" });
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("rejects a WAV with no data chunk as empty audio", async () => {
    const errors: Error[] = [];
    const player = new WavPlayer({ onEnded: () => {}, onError: (e) => errors.push(e) });
    await expect(player.play(WAV_NO_DATA)).rejects.toMatchObject({ name: "EmptyAudioError" });
    expect(errors[0].name).toBe("EmptyAudioError");
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("rejects undecodable base64 with DecodeError", async () => {
    const player = new WavPlayer({ onEnded: () => {}, onError: () => {} });
    await expect(player.play("!!!not-base64!!!")).rejects.toMatchObject({ name: "DecodeError" });
  });
});

describe("WavPlayer — element playback path", () => {
  it("plays a valid WAV, fires onStarted then onEnded, and revokes the object URL", async () => {
    const events: string[] = [];
    const player = new WavPlayer({
      onStarted: () => events.push("started"),
      onEnded: () => events.push("ended"),
      onError: () => events.push("error"),
    });
    const done = player.play(WAV_OK, "audio/wav", null);
    await Promise.resolve();
    expect(events).toEqual(["started"]);
    const el = FakeAudio.instances[0];
    expect(el.src).toContain("blob:");
    el.finish();
    await done;
    expect(events).toEqual(["started", "ended"]);
    expect(revokedUrls).toHaveLength(1);
  });

  it("surfaces autoplay rejection as a blocked error and revokes the URL", async () => {
    FakeAudio.playResult = "reject-blocked";
    const errors: Error[] = [];
    const player = new WavPlayer({ onEnded: () => {}, onError: (e) => errors.push(e) });
    await player.play(WAV_OK, "audio/wav", null);
    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe("NotAllowedError");
    expect(errors[0].message).toMatch(/blocked/i);
    expect(revokedUrls).toHaveLength(1);
  });

  it("stop() interrupts playback without firing onEnded and revokes the URL", async () => {
    const events: string[] = [];
    const player = new WavPlayer({
      onStarted: () => events.push("started"),
      onEnded: () => events.push("ended"),
      onError: () => events.push("error"),
    });
    const done = player.play(WAV_OK, "audio/wav", null);
    await Promise.resolve();
    player.stop();
    await done;
    expect(events).toEqual(["started"]);
    expect(revokedUrls).toHaveLength(1);
  });

  it("autoplay rejection is followed by successful playback on the next (manual) attempt", async () => {
    // Attempt 1: mobile autoplay refused — surfaces as a recoverable error.
    FakeAudio.playResult = "reject-blocked";
    const errors: Error[] = [];
    const blocked = new WavPlayer({ onEnded: () => {}, onError: (e) => errors.push(e) });
    await blocked.play(WAV_OK, "audio/wav", null);
    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe("NotAllowedError");
    // Attempt 2: the tap on "Tap to Play AI Reply" runs play() again inside
    // a real gesture — the same bytes must now start and finish cleanly.
    FakeAudio.playResult = "resolve";
    const events: string[] = [];
    const manual = new WavPlayer({
      onStarted: () => events.push("started"),
      onEnded: () => events.push("ended"),
      onError: () => events.push("error"),
    });
    const done = manual.play(WAV_OK, "audio/wav", null);
    await Promise.resolve();
    expect(events).toEqual(["started"]);
    FakeAudio.instances[1].finish();
    await done;
    expect(events).toEqual(["started", "ended"]);
  });
});

describe("WavPlayer — Web Audio path (gesture-unlocked context)", () => {
  it("decodes and plays through the provided AudioContext", async () => {
    const events: string[] = [];
    const ctx = new FakeAudioContext() as unknown as AudioContext;
    const player = new WavPlayer({
      onStarted: () => events.push("started"),
      onEnded: () => events.push("ended"),
      onError: () => events.push("error"),
    });
    const done = player.play(WAV_OK, "audio/wav", ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["started"]);
    // No HTMLAudioElement involved on this path.
    expect(FakeAudio.instances).toHaveLength(0);
    const source = (ctx as unknown as FakeAudioContext).created[0];
    expect(source.started).toBe(true);
    source.onended?.();
    await done;
    expect(events).toEqual(["started", "ended"]);
  });

  it("falls back to the element path when decode fails", async () => {
    const ctx = {
      state: "running",
      destination: {},
      decodeAudioData: () => Promise.reject(new Error("unsupported")),
      createBufferSource: () => new FakeBufferSource(),
    } as unknown as AudioContext;
    const player = new WavPlayer({ onEnded: () => {}, onError: () => {} });
    const done = player.play(WAV_OK, "audio/wav", ctx);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(1);
    FakeAudio.instances[0].finish();
    await done;
  });
});

describe("WavPlayer — mobile AudioContext guards (never a silent success)", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("a context that never reaches 'running' falls back to the element path instead of starting silent audio", async () => {
    let decoded = 0;
    const ctx = {
      state: "suspended",
      destination: {},
      resume: () => Promise.resolve(), // resume attempt does not revive it
      decodeAudioData: () => {
        decoded += 1;
        return Promise.resolve({ duration: 1.2 });
      },
      createBufferSource: () => new FakeBufferSource(),
    } as unknown as AudioContext;
    const events: string[] = [];
    const player = new WavPlayer({
      onStarted: () => events.push("started"),
      onEnded: () => events.push("ended"),
      onError: () => events.push("error"),
    });
    const done = player.play(WAV_OK, "audio/wav", ctx);
    await tick();
    // No phantom buffer start: the element path carries the clip instead,
    // where autoplay rejection surfaces as a real, recoverable error.
    expect(decoded).toBe(0);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(events).toEqual(["started"]);
    FakeAudio.instances[0].finish();
    await done;
    expect(events).toEqual(["started", "ended"]);
  });

  it("re-checks the context after decoding (iOS suspends mid-decode) and uses the element path", async () => {
    let state = "running";
    let decoded = 0;
    let sourcesCreated = 0;
    const ctx = {
      get state() {
        return state;
      },
      destination: {},
      resume: () => Promise.resolve(),
      decodeAudioData: () => {
        decoded += 1;
        state = "suspended"; // the phone suspended the context during decode
        return Promise.resolve({ duration: 1.2 });
      },
      createBufferSource: () => {
        sourcesCreated += 1;
        return new FakeBufferSource();
      },
    } as unknown as AudioContext;
    const events: string[] = [];
    const player = new WavPlayer({
      onStarted: () => events.push("started"),
      onEnded: () => events.push("ended"),
      onError: () => events.push("error"),
    });
    const done = player.play(WAV_OK, "audio/wav", ctx);
    await tick();
    expect(decoded).toBe(1);
    // Starting the buffer here would report success with zero sound.
    expect(sourcesCreated).toBe(0);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(events).toEqual(["started"]);
    FakeAudio.instances[0].finish();
    await done;
    expect(events).toEqual(["started", "ended"]);
  });

  it("a buffer source whose start() throws falls back to the element path instead of erroring", async () => {
    class ThrowingSource extends FakeBufferSource {
      start(): void {
        throw new Error("context interrupted");
      }
    }
    const ctx = {
      state: "running",
      destination: {},
      decodeAudioData: () => Promise.resolve({ duration: 1.2 }),
      createBufferSource: () => new ThrowingSource(),
    } as unknown as AudioContext;
    const events: string[] = [];
    const player = new WavPlayer({
      onStarted: () => events.push("started"),
      onEnded: () => events.push("ended"),
      onError: () => events.push("error"),
    });
    const done = player.play(WAV_OK, "audio/wav", ctx);
    await tick();
    expect(FakeAudio.instances).toHaveLength(1);
    // Recovery, not an error: the element path took over and started.
    expect(events).not.toContain("error");
    FakeAudio.instances[0].finish();
    await done;
    expect(events).toEqual(["started", "ended"]);
  });
});
