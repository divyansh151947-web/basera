"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles } from "lucide-react";
import {
  VoiceLoopController,
  toVoiceLoopError,
  type MicStreamLike,
  type PlayerHandle,
  type RecordedAudio,
  type RecorderLike,
  type TurnAudio,
  type TurnResult,
  type VoiceLoopState,
} from "@/lib/voice/voice-loop-controller";
import { isAutoplayBlockedError, WavPlayer } from "@/lib/voice/wav-player";
import { voiceDiag } from "@/lib/voice/voice-diagnostics";
import { VOICE_GREETING_TEXT } from "@/lib/voice/voice-greeting";
import { VOICE_TOUR_EVENT, type VoiceClientAction } from "@/lib/ai/tour-navigation";
import { isPublicOrgUnavailableError, PUBLIC_ORG_UNAVAILABLE_MESSAGE, resolvePublicChatOrgSlug } from "@/lib/public-chat";

type VoiceMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/** The latest AI audio clip (greeting or reply). It is kept for the whole
 *  session — not only when playback failed — so a one-tap button can always
 *  push the AI's audio out manually. Mobile browsers frequently refuse or
 *  silently drop automatic playback, and a button inside a real tap is the
 *  one playback path they never block. `blocked` marks that the last
 *  automatic attempt was refused or failed. */
type ReplayClip = {
  base64: string;
  mimeType: string;
  kind: "greeting" | "reply";
  blocked: boolean;
};

const STATUS: Record<VoiceLoopState, string> = {
  idle: "Idle",
  "requesting-mic": "Requesting microphone…",
  greeting: "Saying hello…",
  listening: "Listening",
  recording: "Listening — you are speaking",
  processing: "Thinking…",
  speaking: "Playing AI reply",
  ended: "Session ended",
  error: "Error",
};

const LIVE_STATES: VoiceLoopState[] = [
  "requesting-mic",
  "greeting",
  "listening",
  "recording",
  "processing",
  "speaking",
];

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* keep probing */
    }
  }
  return "";
}

/**
 * Basera Voice panel.
 *
 * ONE CLICK, then the microphone stays on:
 * mic permission -> setup -> exactly ONE greeting -> listening -> speech ->
 * transcript -> reply -> audio -> listening again, with no further clicks.
 *
 * The loop, VAD, barge-in, single-greeting guard and text fallback all live in
 * the shared VoiceLoopController, so the main panel and the 3D Talk to Agent
 * run on one voice foundation. Language is detected server-side per turn, so
 * English, Hindi and Hinglish can be mixed in a single session.
 */
export function VoiceSessionWidget({ defaultOrgSlug }: { defaultOrgSlug?: string }) {
  // Default slug: explicit prop wins, else the configured
  // NEXT_PUBLIC_PUBLIC_ORG_SLUG, else the shipped default workspace. (Before,
  // this was hardcoded to "urbannest" even when the deployment targeted a
  // different workspace, which made the voice panel 404 with a raw
  // "Unknown business".)
  const [orgSlug, setOrgSlug] = useState(
    () => defaultOrgSlug ?? resolvePublicChatOrgSlug(process.env.NEXT_PUBLIC_PUBLIC_ORG_SLUG)
  );
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState<VoiceLoopState>("idle");
  const [replayClip, setReplayClip] = useState<ReplayClip | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const startingRef = useRef(false);
  /** Latest server-detected language ("en" | "hi" | "hinglish"), used to pick
   *  the correct browser speechSynthesis voice when server TTS is unavailable. */
  const langRef = useRef<string>("en");
  const greetedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** Non-loop clip (greeting / manual replay) so a new clip can stop the
   *  previous one and nothing ever plays over something else. */
  const auxiliaryPlayerRef = useRef<WavPlayer | null>(null);
  /** The controller's onEnded for the ACTIVE reply. stop() never fires
   *  onEnded, so when a tap (Play/dismiss) stops the controller's own reply
   *  player the loop must be notified or it would wedge in `speaking`
   *  forever. The controller's handler is idempotent, so a stale reference
   *  is a harmless no-op. */
  const replyEndRef = useRef<(() => void) | null>(null);
  /** Reply text of a turn whose TTS produced NO audio (quota/outage): shown
   *  as an honest error with a tap-to-speak retry (mobile blocks background
   *  speech synthesis, so the retry must run inside a real tap). */
  const [ttsMissed, setTtsMissed] = useState<string | null>(null);

  const pushMessage = useCallback((role: VoiceMessage["role"], content: string) => {
    const text = content.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: newId(), role, content: text }]);
  }, []);

  const releaseMedia = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    } catch {
      /* best effort */
    }
    streamRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {
      /* best effort */
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  /** Mute/unmute the microphone stream tracks directly (not just the recorder).
   *  This ensures AI speech is never captured, even if recorder is not active. */
  const setMicMuted = useCallback((muted: boolean) => {
    try {
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    } catch {
      /* best effort */
    }
  }, []);

  /** Browser speech-synthesis fallback. Prefers a female voice but NEVER
   *  goes silent: if no female voice exists for the language (most mobile
   *  browsers ship voices without "female" in the name), any voice for the
   *  language — or the browser default — is used instead. Previously this
   *  resolved with no speech at all, which made greetings and TTS-miss
   *  replies appear as text with no sound. */
  const speakText = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const tag = langRef.current === "hi" ? "hi-IN" : "en-IN";
        utterance.lang = tag;
        const voices = window.speechSynthesis.getVoices();
        const normalize = (lang: string) => lang.replace("_", "-").toLowerCase();
        const sameLang = (lang: string) => normalize(lang) === tag.toLowerCase();
        const langPrefix = (lang: string) => normalize(lang).startsWith(tag.slice(0, 2));
        const isFemale = (name: string) => /female|feminine|woman/i.test(name);
        const voice =
          voices.find((v) => sameLang(v.lang) && isFemale(v.name)) ??
          voices.find((v) => langPrefix(v.lang) && isFemale(v.name)) ??
          voices.find((v) => sameLang(v.lang)) ??
          voices.find((v) => langPrefix(v.lang)) ??
          null;
        if (voice) utterance.voice = voice;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
        // Some engines never fire onend (muted device, interrupted synthesis):
        // bound the wait so the voice loop can never wedge on speech text.
        setTimeout(finish, Math.min(20000, 3000 + text.length * 90));
      } catch {
        resolve();
      }
    });
  }, []);

  const stopSpeaking = useCallback(() => {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* best effort */
    }
    setMicMuted(false);
  }, [setMicMuted]);

  /** Gesture-time audio unlock. Created/resumed INSIDE the click handler so
   *  iOS Safari and Android Chrome allow later buffer playback through this
   *  context. Silent-clip "priming" of HTMLAudioElement is deliberately NOT
   *  relied on: it never guarantees future playback. Returns the shared
   *  context (or null where Web Audio is unavailable). */
  const unlockAudioDuringGesture = useCallback((): AudioContext | null => {
    try {
      let context = audioCtxRef.current;
      if (!context || context.state === "closed") {
        const Ctor =
          typeof window !== "undefined"
            ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            : undefined;
        if (!Ctor) return null;
        context = new Ctor();
        audioCtxRef.current = context;
      }
      if (context.state !== "running" && context.state !== "closed") {
        // Not only "suspended": iOS reports interrupted contexts after a
        // call/route change/lock, and resume() is still the right call.
        void context.resume().catch(() => undefined);
      }
      return context;
    } catch {
      return null;
    }
  }, []);

  /** Stop whichever clip (manual replay / greeting) is still playing so two
   *  utterances can never overlap. A raw stop() never fires the player's
   *  onEnded, so this also (a) releases the mic the stopped reply had muted
   *  and, when the stopped clip WAS the controller's active reply, (b) tells
   *  the loop playback is over — otherwise it would hang in `speaking`
   *  forever. The controller's handler is idempotent, and the ref is nulled
   *  together with the notification, so a stale/finished reply never flips
   *  the state of a newer one. */
  const stopAuxiliaryPlayback = useCallback(() => {
    auxiliaryPlayerRef.current?.stop();
    auxiliaryPlayerRef.current = null;
    setMicMuted(false);
    const notify = replyEndRef.current;
    replyEndRef.current = null;
    notify?.();
  }, [setMicMuted]);

  /** Play one TTS clip. Uses the gesture-unlocked AudioContext when present,
   *  falls back to an HTMLAudioElement. The clip is registered in
   *  `replayClip` the moment it arrives — BEFORE playback is attempted — so a
   *  one-tap button can always push the audio out, even when the browser
   *  blocks autoplay or "succeeds" silently (mobile trap). Playback errors
   *  only flip `blocked`; clips with no playable bytes are unregistered (a
   *  re-click could never succeed). Resolves "ended" | "blocked" | "failed". */
  const playClip = useCallback(
    (
      base64: string,
      mimeType: string,
      kind: ReplayClip["kind"],
      onStarted?: () => void
    ): Promise<"ended" | "blocked" | "failed"> =>
      new Promise((resolve) => {
        let settled = false;
        const finish = (outcome: "ended" | "blocked" | "failed") => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        };
        const sameClip = (current: ReplayClip | null): current is ReplayClip => !!current && current.base64 === base64;
        const offerReplay = (err?: Error) => {
          if (!base64) return;
          if (err && (err.name === "EmptyAudioError" || err.name === "DecodeError")) {
            // Bytes can never play — drop the clip so the button never lies.
            setReplayClip((current) => (sameClip(current) ? null : current));
            return;
          }
          setReplayClip({ base64, mimeType, kind, blocked: Boolean(err) });
        };
        // The clip is available for manual push from the very first frame.
        offerReplay();
        const player = new WavPlayer({
          onStarted: () => {
            // Playback actually began — clip stays available, no longer blocked.
            setReplayClip((current) => (sameClip(current) ? { ...current, blocked: false } : current));
            onStarted?.();
          },
          onEnded: () => finish("ended"),
          onError: (err) => {
            offerReplay(err);
            finish(isAutoplayBlockedError(err) ? "blocked" : "failed");
          },
        });
        auxiliaryPlayerRef.current = player;
        player.play(base64, mimeType, audioCtxRef.current).then(
          () => finish("ended"),
          (err: unknown) => {
            const error = err instanceof Error ? err : new Error("playback failed");
            offerReplay(error);
            finish(isAutoplayBlockedError(error) ? "blocked" : "failed");
          }
        );
      }),
    []
  );

  /** Manual Play button handler — the guaranteed audio path on mobile.
   *  Runs inside a real click/tap, which is exactly the gesture mobile
   *  browsers never refuse. Keeps the clip available unless playback
   *  succeeds or the bytes are unplayable. */
  const playReplayClip = useCallback(async () => {
    const clip = replayClip;
    if (!clip) return;
    unlockAudioDuringGesture();
    // Stop first (releases mic/loop of a stopped reply), then mute for the
    // replay — synchronously, so the loop never samples an unmuted mic
    // while AI audio plays.
    stopAuxiliaryPlayback();
    setMicMuted(true);
    const outcome = await playClip(clip.base64, clip.mimeType, clip.kind);
    setMicMuted(false);
    voiceDiag("manual-play", { kind: clip.kind, outcome });
  }, [replayClip, playClip, setMicMuted, stopAuxiliaryPlayback, unlockAudioDuringGesture]);

  /** Explicit opt-out for the play prompt: stops any in-flight replay and
   *  forgets the clip. The clip is otherwise kept until playback succeeds. */
  const dismissReplay = useCallback(() => {
    stopAuxiliaryPlayback();
    setReplayClip(null);
  }, [stopAuxiliaryPlayback]);

  /** Retry for a TTS miss: speak the EXACT reply with the device voice
   *  inside this tap — mobile browsers block speech synthesis that starts
   *  outside a gesture, so a tap is what makes the retry audible. */
  const playTtsMissedVoice = useCallback(async () => {
    const text = ttsMissed;
    if (!text) return;
    unlockAudioDuringGesture();
    stopAuxiliaryPlayback();
    setMicMuted(true);
    try {
      await speakText(text);
      voiceDiag("tts-missed-retry", { chars: text.length });
    } finally {
      setMicMuted(false);
    }
  }, [ttsMissed, speakText, unlockAudioDuringGesture, setMicMuted, stopAuxiliaryPlayback]);

  /** Reply playback for the voice loop: mutes the mic so the AI never hears
   *  itself, unmuting on every exit path. The clip is registered in
   *  `replayClip` as soon as it arrives so a Play reply button is always
   *  there to push the audio out manually (mobile's guaranteed path), and it
   *  still reports the error so the loop resumes listening instead of
   *  hanging. */
  const playAudioWithMicMute = useCallback(
    (base64: string, mimeType: string, onEnded: () => void, onError: (err: Error) => void): PlayerHandle => {
      const clipMime = mimeType || "audio/wav";
      // Latest reply clip becomes the pushable one immediately.
      setReplayClip(base64 ? { base64, mimeType: clipMime, kind: "reply", blocked: false } : null);
      // Stop/clear FIRST (it may unmute a stopped reply), THEN mute the mic
      // for this playback — in the same synchronous block, so no loop tick
      // can ever sample the unmuted mic while AI audio plays.
      stopAuxiliaryPlayback();
      setMicMuted(true);
      // THIS reply's end callback: a tap that stops the active player must
      // release the loop through it (stop() can never fire onEnded) — see
      // stopAuxiliaryPlayback. finish() below invalidates it again.
      replyEndRef.current = onEnded;
      const sameClip = (current: ReplayClip | null): current is ReplayClip => !!current && current.base64 === base64;
      const markBlocked = (errName: string) => {
        if (!base64) return;
        if (errName === "EmptyAudioError" || errName === "DecodeError") {
          // Bytes can never play — drop the clip so the button never lies.
          setReplayClip((current) => (sameClip(current) ? null : current));
          return;
        }
        setReplayClip((current) => (sameClip(current) ? { ...current, blocked: true } : current));
      };
      let ended = false;
      const finish = () => {
        if (ended) return;
        ended = true;
        // This reply is settled (ended/errored/stopped): it can no longer
        // release the loop, so forget its callback.
        replyEndRef.current = null;
        setMicMuted(false);
      };
      const player = new WavPlayer({
        onStarted: () =>
          setReplayClip((current) => (sameClip(current) ? { ...current, blocked: false } : current)),
        onEnded: () => {
          finish();
          onEnded();
        },
        onError: (err) => {
          finish();
          markBlocked(err.name);
          onError(err);
        },
      });
      auxiliaryPlayerRef.current = player;
      player.play(base64, clipMime, audioCtxRef.current).catch((err: unknown) => {
        finish();
        const name = err instanceof Error ? err.name : "unknown";
        markBlocked(name);
        voiceDiag("reply-playback-rejected", {
          name,
          bytes: base64.length,
          mime: clipMime,
        });
      });
      return {
        stop: () => {
          finish();
          player.stop();
        },
      };
    },
    [setMicMuted, stopAuxiliaryPlayback]
  );

  const controller = useMemo(() => {
    const requestMic = async (): Promise<MicStreamLike> => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      try {
        // Reuse the context unlocked inside the Start click when possible; a
        // context created here may still be suspended on mobile browsers and
        // is only used for mic energy sampling anyway.
        let context = audioCtxRef.current;
        if (!context || context.state === "closed") {
          context = new AudioContext();
          audioCtxRef.current = context;
        }
        if (context.state !== "running" && context.state !== "closed") {
          await context.resume().catch(() => undefined);
        }
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;
      } catch {
        /* energy sampling degrades to silence; turns still work */
      }
      return {
        stop: () => {
          releaseMedia();
        },
      };
    };

    const createRecorder = (
      onStop: (audio: RecordedAudio | null) => void,
      onError: (err: Error) => void
    ): RecorderLike => {
      const stream = streamRef.current;
      if (!stream || typeof MediaRecorder === "undefined") {
        throw new Error("Microphone stream unavailable.");
      }
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) {
          onStop(null);
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => onStop(null);
        reader.onload = () => {
          const result = String(reader.result ?? "");
          const comma = result.indexOf(",");
          onStop({
            base64: comma >= 0 ? result.slice(comma + 1) : result,
            mimeType: blob.type || "audio/webm",
          });
        };
        reader.readAsDataURL(blob);
      };
      recorder.onerror = () => onError(new Error("Recording failed."));
      // Some browsers (notably Safari/iOS versions) reject the timeslice
      // argument; fall back to a single-chunk recording so the turn still
      // gets audio instead of dying on recorder.start().
      try {
        recorder.start(250);
      } catch {
        recorder.start();
      }
      return {
        get state() {
          return recorder.state as "inactive" | "recording" | "paused";
        },
        stop: () => {
          try {
            if (recorder.state !== "inactive") recorder.stop();
          } catch {
            /* best effort */
          }
        },
        setMuted: (muted: boolean) => {
          stream.getAudioTracks().forEach((track) => {
            track.enabled = !muted;
          });
        },
      };
    };

    const sampleEnergy = (): number => {
      const analyser = analyserRef.current;
      if (!analyser) return 0;
      try {
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) {
          const value = Math.abs(data[i] - 128) / 128;
          if (value > peak) peak = value;
        }
        return peak;
      } catch {
        return 0;
      }
    };

    const sendTurn = async (audio: TurnAudio | null, transcriptText: string): Promise<TurnResult> => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        throw toVoiceLoopError(null, "Voice session is not ready.");
      }
      const response = await fetch(`/api/voice/session/${sessionId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptText,
          ...(audio ? { audioBase64: audio.base64, audioMimeType: audio.mimeType } : {}),
        }),
      });
      if (!response.ok) {
        let message = `The voice turn failed (${response.status}).`;
        let serverCode: string | null = null;
        try {
          const payload = await response.json();
          if (payload?.error) message = String(payload.error);
          if (payload?.code) serverCode = String(payload.code);
        } catch {
          /* keep default */
        }
        throw toVoiceLoopError(response.status, message, serverCode);
      }
      const data = await response.json();
      const action = (data?.voiceAction ?? null) as VoiceClientAction | null;
      if (action) {
        window.dispatchEvent(new CustomEvent(VOICE_TOUR_EVENT, { detail: action }));
      }
      if (typeof data?.language === "string" && data.language) {
        langRef.current = data.language;
      }
      const replyText = String(data?.reply ?? "");
      if (data?.replyAudioBase64) {
        // Fresh turn with audio: no stale error card.
        setTtsMissed(null);
      } else {
        // TTS produced NO clip this turn (quota/outage — the server marks it
        // ttsMissed but still returns the reply text). Drop the PREVIOUS
        // reply's button so a tap can never replay stale audio, stop any old
        // clip so it cannot mix with the fallback voice, and show an honest
        // error with a tap-to-speak retry below.
        setReplayClip(null);
        stopAuxiliaryPlayback();
        setTtsMissed(replyText || null);
      }
      return {
        reply: replyText,
        replyAudioBase64: data?.replyAudioBase64 ?? null,
        replyAudioMimeType: data?.replyAudioMimeType ?? null,
        transcript: data?.transcriptText ?? null,
      };
    };

    /** Greeting: fetch once, show the text immediately, and play the
     *  greeting audio when the server produced it. The clip is pushable from
     *  arrival (Play greeting button), so autoplay restrictions and mobile
     *  silent playback cannot lose it; unusable bytes fall back to the
     *  browser voice so the greeting is never silent. */
    const speakGreeting = async (): Promise<void> => {
      if (greetedRef.current) return;
      greetedRef.current = true;
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      let greeting = VOICE_GREETING_TEXT;
      try {
        const response = await fetch(`/api/voice/session/${sessionId}/greet`, { method: "POST" });
        if (!response.ok) throw new Error(`Greeting unavailable (${response.status}).`);
        const data = await response.json();
        greeting = String(data?.greeting || VOICE_GREETING_TEXT);
        pushMessage("assistant", greeting);
        const audioBase64 = typeof data?.audioBase64 === "string" ? data.audioBase64 : "";
        const audioMime = typeof data?.audioMimeType === "string" && data.audioMimeType ? data.audioMimeType : "audio/wav";
        voiceDiag("greeting:received", {
          hasAudio: Boolean(audioBase64),
          audioChars: audioBase64.length,
          mime: audioMime,
          alreadyGreeted: Boolean(data?.alreadyGreeted),
        });
        if (audioBase64) {
          setMicMuted(true);
          let heard = false;
          try {
            const outcome = await playClip(audioBase64, audioMime, "greeting", () => {
              heard = true;
            });
            voiceDiag("greeting:playback", { outcome });
            if (outcome === "failed" && !heard) {
              // Unplayable bytes: no button can ever help, so speak the
              // greeting with the browser voice instead of going silent.
              await speakText(greeting);
            }
          } finally {
            setMicMuted(false);
          }
          // "blocked"/"failed" already kept the clip in replayClip, which
          // renders the Play greeting button — nothing else to do here.
        } else {
          // No server audio (TTS missed/rate-limited): speak via the browser
          // so the greeting is never text-only.
          await speakText(greeting);
        }
      } catch {
        pushMessage("assistant", VOICE_GREETING_TEXT);
        await speakText(VOICE_GREETING_TEXT);
      }
    };

    return new VoiceLoopController(
      {
        requestMic,
        createRecorder,
        sampleEnergy,
        sendTurn,
        playAudio: playAudioWithMicMute,
        speakText,
        speakGreeting,
        stopSpeaking,
        scheduleTick: (fn, ms) => setInterval(fn, ms),
        cancelTick: (handle) => {
          if (handle !== null && handle !== undefined) clearInterval(handle as ReturnType<typeof setInterval>);
        },
        now: () => Date.now(),
        onState: (next) => {
          setState(next);
          if (next !== "error") setError(null);
        },
        onError: (_code, message) => {
          setError(message);
        },
        onTranscript: (text) => pushMessage("user", text),
        onReply: (text) => pushMessage("assistant", text),
      },
      {
        // More generous silence timeout for natural speech pauses
        silenceMs: 2000,
        // Require at least 500ms of speech before sending (avoid accidental triggers)
        minSpeechMs: 500,
      }
    );
  }, [playClip, pushMessage, releaseMedia, speakText, stopSpeaking, playAudioWithMicMute, setMicMuted, stopAuxiliaryPlayback]);

  const createSession = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgSlug }),
      });
      if (!response.ok) {
        let message = `Voice is unavailable (${response.status}).`;
        let orgNotFound = false;
        try {
          const payload = await response.json();
          if (payload?.error) message = String(payload.error);
          // Machine-readable signal from ORG_NOT_FOUND responses (backwards
          // compatible with the older error-string-only mapping).
          orgNotFound = payload?.code === "ORG_NOT_FOUND" || isPublicOrgUnavailableError(message);
        } catch {
          /* keep default */
        }
        // 404 ORG_NOT_FOUND means the workspace slug has no org row in
        // the database — show the honest "not connected yet" message instead
        // of raw API jargon.
        if (orgNotFound) message = PUBLIC_ORG_UNAVAILABLE_MESSAGE;
        setError(message);
        return null;
      }
      const data = await response.json();
      const id = String(data?.sessionId ?? "");
      sessionIdRef.current = id || null;
      return id || null;
    } catch {
      setError("Voice could not start. Check your connection and try again.");
      return null;
    }
  }, [orgSlug]);

  const endSession = useCallback(async () => {
    stopSpeaking();
    stopAuxiliaryPlayback();
    setReplayClip(null);
    setTtsMissed(null);
    await controller.end();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    greetedRef.current = false;
    if (sessionId) {
      try {
        await fetch(`/api/voice/session/${sessionId}/end`, { method: "POST" });
      } catch {
        /* ending locally is enough */
      }
    }
    releaseMedia();
  }, [controller, releaseMedia, stopAuxiliaryPlayback, stopSpeaking]);

  const startTextMode = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      // Inside the click: unlock the AudioContext before any await so later
      // reply playback is allowed on mobile browsers.
      unlockAudioDuringGesture();
      if (!sessionIdRef.current) {
        const id = await createSession();
        if (!id) return;
      }
      greetedRef.current = false;
      await controller.startTextOnly();
    } finally {
      startingRef.current = false;
    }
  }, [controller, createSession, unlockAudioDuringGesture]);

  const handleStart = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      // FIRST statement inside the click handler: creating/resuming the
      // AudioContext here (not after the session fetch) is what iOS Safari
      // and Android Chrome require to allow TTS playback later in the turn.
      unlockAudioDuringGesture();
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        await startTextMode();
        return;
      }
      const id = await createSession();
      if (!id) return;
      greetedRef.current = false;
      await controller.start();
    } catch {
      setError("Voice could not start. You can keep typing instead.");
    } finally {
      startingRef.current = false;
    }
  }, [controller, createSession, startTextMode, unlockAudioDuringGesture]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput("");
      // Typed turns also auto-play a reply: unlock audio inside this click.
      unlockAudioDuringGesture();
      if (!sessionIdRef.current) {
        const id = await createSession();
        if (!id) return;
      }
      if (state === "idle" || state === "error" || state === "ended") {
        greetedRef.current = true;
        await controller.startTextOnly();
      }
      await controller.sendTypedTranscript(text);
    },
    [controller, createSession, input, state, unlockAudioDuringGesture]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    return () => {
      void controller.end();
      auxiliaryPlayerRef.current?.dispose();
      auxiliaryPlayerRef.current = null;
      releaseMedia();
    };
  }, [controller, releaseMedia]);

  const isLive = LIVE_STATES.includes(state);
  const micDenied = !!error && /microphone|permission|device/i.test(error);

  return (
    <div className="theme-light overflow-hidden rounded-[24px] border border-line bg-panel shadow-float">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,81,50,0.28)]">
            B
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">Basera Voice</p>
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate">
              <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-success" : "bg-line"}`} aria-hidden />
              {isLive ? `Live · ${STATUS[state]}` : STATUS[state]}
            </p>
          </div>
        </div>
        {isLive ? (
          <button
            type="button"
            onClick={() => void endSession()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-danger/25 bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger transition hover:border-danger/40"
          >
            <MicOff size={14} /> Stop voice
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={startingRef.current || state === "requesting-mic"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Mic size={14} /> Start voice
          </button>
        )}
      </div>

      <div className="border-b border-line bg-gold-light/40 px-4 py-2.5 text-[11px] leading-relaxed text-slate">
        Click Start voice once and allow the microphone. Keep talking — the reply plays by
        itself and listening resumes. Click Stop voice to end. English, Hindi and Hinglish can
        be mixed freely in one conversation.
      </div>

      {/* Conversation is double-bounded: 420px design height, capped at 70vh
          and never so tall that the header + tips + input would push the top
          edge of the panel off a short viewport (e.g. landscape phones, where
          70vh + the ~150px of fixed chrome would exceed the screen; the log
          then scrolls internally). */}
      <div className="flex h-[420px] max-h-[min(70vh,calc(100svh-18rem))] flex-col bg-[#f7f8f7]">
        <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4" role="log" aria-live="polite" aria-label="Voice conversation">
          {!isLive && messages.length === 0 && (
            <div className="rounded-[18px] border border-line bg-white px-3.5 py-3 text-sm text-slate shadow-[0_2px_10px_rgba(16,26,23,0.05)]">
              <p className="font-medium text-ink">Talk hands-free</p>
              <p className="mt-1 text-[13px] leading-relaxed">
                1. Confirm the business slug.
                <br />
                2. Press Start voice and allow the microphone.
                <br />
                3. Just speak — e.g. &ldquo;Hi, mujhe Jaipur mein 3 BHK chahiye&rdquo;. The
                reply plays by itself, then listening resumes.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label htmlFor="voice-org" className="text-xs font-semibold text-slate">
                  Business
                </label>
                <input
                  id="voice-org"
                  value={orgSlug}
                  onChange={(event) => setOrgSlug(event.target.value)}
                  placeholder="urbannest"
                  className="w-40 rounded-xl border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-slate focus:border-brand"
                />
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`chat-msg flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[86%] whitespace-pre-line px-3.5 py-2.5 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "rounded-[18px] rounded-br-md bg-brand text-white shadow-[0_8px_18px_rgba(15,81,50,0.18)]"
                    : "rounded-[18px] rounded-bl-md border border-line bg-white text-ink shadow-[0_2px_10px_rgba(16,26,23,0.05)]"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}

          {replayClip && (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void playReplayClip()}
                  className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-brand-strong"
                  aria-label={replayClip.kind === "greeting" ? "Play greeting audio" : "Play AI reply audio"}
                >
                  🔊 {replayClip.kind === "greeting" ? "Tap to Play Greeting" : "Tap to Play AI Reply"}
                </button>
                <button
                  type="button"
                  onClick={dismissReplay}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate transition hover:text-ink"
                  aria-label="Dismiss play button"
                >
                  ✕
                </button>
              </div>
              <p className="text-[11px] text-slate">
                {replayClip.blocked
                  ? "Tap to enable audio — your browser blocked automatic playback."
                  : "Tap any time to hear the AI voice."}
              </p>
            </div>
          )}
          {ttsMissed && (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <p className="max-w-full rounded-xl border border-danger/25 bg-danger-soft px-3 py-1.5 text-center text-[11px] font-medium text-danger">
                Voice audio could not be generated for this reply (TTS unavailable).
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void playTtsMissedVoice()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-strong"
                >
                  🔊 Tap to Play with device voice
                </button>
                <button
                  type="button"
                  onClick={() => setTtsMissed(null)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate transition hover:text-ink"
                  aria-label="Dismiss audio error"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          {isLive && (
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-brand shadow-sm">
                <Sparkles size={12} className="text-brand" />
                {STATUS[state]}
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-2">
              <div className="max-w-full rounded-full border border-danger/25 bg-danger-soft px-3 py-1.5 text-center text-xs font-medium text-danger">
                {error}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {micDenied && (
                  <button
                    type="button"
                    onClick={() => void startTextMode()}
                    className="rounded-full border border-brand/30 bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand transition hover:border-brand/60"
                  >
                    Continue without microphone
                  </button>
                )}
                {!micDenied && (
                  <button
                    type="button"
                    onClick={() => void handleStart()}
                    className="rounded-full border border-brand/30 bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand transition hover:border-brand/60"
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-line bg-white px-3 py-3">
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSubmit(event as unknown as FormEvent<HTMLFormElement>);
                }
              }}
              placeholder={isLive ? "No microphone? Type here instead…" : "Start a voice session, or type below…"}
              className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-[#f8faf9] px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-slate/80 focus:border-brand focus:ring-4 focus:ring-brand/10 placeholder-shown:min-h-[3.75rem]"
              aria-label="Type your message instead of speaking"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-slate/40"
            >
              <Send size={14} /> Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}