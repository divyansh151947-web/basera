/**
 * OPTIONAL CINEMATIC AMBIENT MUSIC for the 3D property experience.
 *
 * Framework-free controller owning exactly ONE audio instance with smooth
 * fade-in/out, mute/unmute, and full cleanup. Browser autoplay rules are
 * respected, never bypassed:
 * - prepare() on mount only preloads (no play attempt, no errors possible).
 * - unlock() attempts playback ONLY from user-gesture call sites (canvas
 *   tap, Enter Property, sound toggle). A rejected play() promise resolves
 *   `false` silently — no repeated autoplay errors, nothing ever throws.
 * - Until the first successful unlock, the control stays in "Sound Off".
 *
 * AUDIO ASSET (licensed file required):
 *   public/audio/basera-ambient.mp3
 * Place a properly licensed/royalty-free cinematic ambient track there
 * (subtle, no vocals, premium nighttime atmosphere). If the file is absent,
 * the element fires `error`, `supported` stays false, the host hides the
 * sound control, and the tour runs silently — the code works unchanged once
 * the licensed file is supplied. NEVER commit copyrighted commercial music.
 */

export const TOUR_AMBIENT_SRC = "/audio/basera-ambient.mp3";

/**
 * Whether `TOUR_AMBIENT_SRC` actually exists in this build.
 *
 * Computed once at build time by next.config.mjs (fs.existsSync on
 * public/audio/basera-ambient.mp3), so the tour never issues a request for a
 * file that is known to be absent — previously every /tour visit paid for a
 * 404. The audio controller itself is unchanged and still handles a
 * late-supplied or custom `src` at runtime; this flag only removes the
 * pointless default-asset probe. Tests that inject their own audio element are
 * unaffected.
 */
export const TOUR_AMBIENT_AVAILABLE = process.env.NEXT_PUBLIC_TOUR_AMBIENT_AVAILABLE === "true";
/** Subtle default level — clearly present, never distracting. */
export const TOUR_AMBIENT_VOLUME = 0.22;

export interface AmbientAudioElement {
  src: string;
  preload: string;
  loop: boolean;
  volume: number;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
  oncanplaythrough: ((() => void) | null);
  onerror: ((() => void) | null);
}

export interface TourAmbientOptions {
  src?: string;
  volume?: number;
  /** Fade duration in ms (each direction). */
  fadeMs?: number;
  /** Audio factory (browser default constructs HTMLAudioElement; tests inject a stub). */
  audioFactory?: () => AmbientAudioElement;
  /** Called once the asset proves playable (host shows the control). */
  onReady?: () => void;
  /** Called if the asset fails to load (host hides the control). */
  onUnsupported?: () => void;
}

export class TourAmbientSound {
  private readonly src: string;
  private readonly targetVolume: number;
  private readonly fadeMs: number;
  private readonly factory: () => AmbientAudioElement;
  private readonly onReady?: () => void;
  private readonly onUnsupported?: () => void;
  private el: AmbientAudioElement | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private unlocked = false;
  private intentOn = true;
  private hidden = false;
  private readyNotified = false;
  private failedNotified = false;

  constructor(options: TourAmbientOptions = {}) {
    this.src = options.src ?? TOUR_AMBIENT_SRC;
    this.targetVolume = options.volume ?? TOUR_AMBIENT_VOLUME;
    this.fadeMs = options.fadeMs ?? 900;
    this.factory = options.audioFactory ?? (() => new Audio() as unknown as AmbientAudioElement);
    this.onReady = options.onReady;
    this.onUnsupported = options.onUnsupported;
  }

  /** Asset has loaded and can play. */
  get supported(): boolean {
    return this.el != null && !this.failedNotified;
  }

  /** Currently audible (playing with volume above silence). */
  get audible(): boolean {
    return this.unlocked && this.intentOn && !this.hidden && (this.el?.paused === false);
  }

  /** Preload only — safe to call on mount, never attempts playback. */
  prepare(): void {
    if (this.el) return;
    try {
      const el = this.factory();
      el.src = this.src;
      el.preload = "auto";
      el.loop = true;
      el.volume = 0;
      el.oncanplaythrough = () => {
        if (!this.readyNotified) {
          this.readyNotified = true;
          this.onReady?.();
        }
      };
      el.onerror = () => {
        if (!this.failedNotified) {
          this.failedNotified = true;
          this.stopFade();
          this.onUnsupported?.();
        }
      };
      this.el = el;
      try {
        el.load();
      } catch {
        // Preload is best-effort; playback attempt decides later.
      }
    } catch {
      this.markUnsupported();
    }
  }

  /**
   * Attempt playback. Call ONLY from user-gesture handlers (or the sound
   * toggle). Resolves true once audible; false when blocked/missing — never
   * throws, never logs repeatedly.
   */
  async unlock(): Promise<boolean> {
    const el = this.el;
    if (!el || this.failedNotified) return false;
    if (!this.intentOn || this.hidden) return false;
    try {
      await el.play();
    } catch {
      return false;
    }
    this.unlocked = true;
    this.fadeTo(this.targetVolume);
    return true;
  }

  /** Mute/unmute toggle (called from the toggle click — a user gesture). */
  setEnabled(on: boolean): void {
    this.intentOn = on;
    if (!this.el || this.failedNotified) return;
    if (!on) {
      this.fadeTo(0, true);
      return;
    }
    if (this.hidden) return;
    // Re-enabling is itself a gesture: try playback directly.
    void this.unlock();
  }

  /** Pause while the scene is hidden; resume the fade when visible again. */
  setSceneVisible(visible: boolean): void {
    this.hidden = !visible;
    const el = this.el;
    if (!el || this.failedNotified) return;
    if (!visible) {
      this.stopFade();
      try {
        el.pause();
      } catch {
        // Best-effort.
      }
      return;
    }
    if (this.intentOn && this.unlocked && el.paused) {
      try {
        const p = el.play();
        if (p instanceof Promise) p.catch(() => undefined);
      } catch {
        // Will retry on the next user gesture.
      }
      this.fadeTo(this.targetVolume);
    }
  }

  /** Fade out and release everything (call on unmount). */
  dispose(): void {
    this.stopFade();
    this.unlocked = false;
    const el = this.el;
    this.el = null;
    if (!el) return;
    try {
      el.pause();
    } catch {
      // Best-effort.
    }
    try {
      el.oncanplaythrough = null;
      el.onerror = null;
      el.src = "";
    } catch {
      // Best-effort.
    }
  }

  private fadeTo(target: number, pauseAtEnd = false): void {
    const el = this.el;
    if (!el) return;
    this.stopFade();
    if (this.fadeMs <= 0) {
      el.volume = target;
      if (pauseAtEnd && target === 0) {
        try {
          el.pause();
        } catch {
          // Best-effort.
        }
      }
      return;
    }
    const from = el.volume;
    const steps = Math.max(1, Math.round(this.fadeMs / 50));
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i += 1;
      const t = Math.min(1, i / steps);
      const host = this.el;
      if (!host) {
        this.stopFade();
        return;
      }
      host.volume = from + (target - from) * t;
      if (t >= 1) {
        this.stopFade();
        if (pauseAtEnd && target === 0) {
          try {
            host.pause();
          } catch {
            // Best-effort.
          }
        }
      }
    }, 50);
  }

  private stopFade(): void {
    if (this.fadeTimer != null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  private markUnsupported(): void {
    if (!this.failedNotified) {
      this.failedNotified = true;
      this.onUnsupported?.();
    }
  }
}
