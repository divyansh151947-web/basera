import { describe, expect, it, vi } from "vitest";

import { TourAmbientSound, TOUR_AMBIENT_SRC, TOUR_AMBIENT_VOLUME, type AmbientAudioElement } from "./tour-ambient";

/** Deterministic stub standing in for HTMLAudioElement (no DOM/audio here). */
function stubAudio() {
  const el = {
    src: "",
    preload: "",
    loop: false,
    volume: 0,
    paused: true,
    playCalls: 0,
    blockNext: false,
    play() {
      this.playCalls += 1;
      if (this.blockNext) {
        this.blockNext = false;
        return Promise.reject(new Error("autoplay blocked"));
      }
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
    load() {
      // Preload is a no-op in the stub; readiness is signaled via emit().
    },
    oncanplaythrough: null as (() => void) | null,
    onerror: null as (() => void) | null,
    emit(name: string) {
      if (name === "canplaythrough") this.oncanplaythrough?.();
      if (name === "error") this.onerror?.();
    },
  };
  return el as unknown as AmbientAudioElement & {
    playCalls: number;
    blockNext: boolean;
    emit(name: string): void;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("tour ambient music (no DOM audio needed)", () => {
  it("uses the documented placeholder asset path and a subtle default level", () => {
    expect(TOUR_AMBIENT_SRC).toBe("/audio/basera-ambient.mp3");
    expect(TOUR_AMBIENT_VOLUME).toBeLessThanOrEqual(0.3);
    const snd = new TourAmbientSound({ audioFactory: stubAudio, fadeMs: 10 });
    snd.prepare();
    expect(snd.supported).toBe(true);
    snd.dispose();
  });

  it("prepare() never attempts playback; unlock() fades in on success", async () => {
    const el = stubAudio();
    const onReady = vi.fn();
    const snd = new TourAmbientSound({ audioFactory: () => el, fadeMs: 20, onReady });
    snd.prepare();
    expect(el.playCalls).toBe(0);
    el.emit("canplaythrough");
    expect(onReady).toHaveBeenCalledTimes(1);
    const ok = await snd.unlock();
    expect(ok).toBe(true);
    await sleep(120);
    expect(el.paused).toBe(false);
    expect(el.volume).toBeCloseTo(TOUR_AMBIENT_VOLUME, 2);
    expect(snd.audible).toBe(true);
    snd.dispose();
  });

  it("blocked autoplay resolves false silently — never throws, never retries in a loop", async () => {
    const el = stubAudio();
    const snd = new TourAmbientSound({ audioFactory: () => el, fadeMs: 10 });
    snd.prepare();
    el.blockNext = true;
    await expect(snd.unlock()).resolves.toBe(false);
    expect(el.playCalls).toBe(1);
    expect(snd.audible).toBe(false);
    snd.dispose();
  });

  it("missing licensed asset marks unsupported (host hides the control)", () => {
    const el = stubAudio();
    const onUnsupported = vi.fn();
    const snd = new TourAmbientSound({ audioFactory: () => el, fadeMs: 10, onUnsupported });
    snd.prepare();
    el.emit("error");
    expect(onUnsupported).toHaveBeenCalledTimes(1);
    expect(snd.supported).toBe(false);
    snd.dispose();
  });

  it("mute fades out and pauses; unmute resumes (single instance throughout)", async () => {
    const el = stubAudio();
    const snd = new TourAmbientSound({ audioFactory: () => el, fadeMs: 20 });
    snd.prepare();
    el.emit("canplaythrough");
    await snd.unlock();
    await sleep(120);
    snd.setEnabled(false);
    await sleep(120);
    expect(el.volume).toBe(0);
    expect(el.paused).toBe(true);
    expect(snd.audible).toBe(false);
    snd.setEnabled(true);
    await sleep(120);
    expect(el.paused).toBe(false);
    expect(el.volume).toBeCloseTo(TOUR_AMBIENT_VOLUME, 2);
    snd.dispose();
    expect(el.paused).toBe(true);
  });

  it("hidden scene pauses; returning resumes the fade", async () => {
    const el = stubAudio();
    const snd = new TourAmbientSound({ audioFactory: () => el, fadeMs: 20 });
    snd.prepare();
    el.emit("canplaythrough");
    await snd.unlock();
    await sleep(120);
    snd.setSceneVisible(false);
    expect(el.paused).toBe(true);
    snd.setSceneVisible(true);
    await sleep(120);
    expect(el.paused).toBe(false);
    snd.dispose();
  });
});
