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
import { WavPlayer } from "@/lib/voice/wav-player";
import { VOICE_GREETING_TEXT } from "@/lib/voice/voice-greeting";
import { VOICE_TOUR_EVENT, type VoiceClientAction } from "@/lib/ai/tour-navigation";

type VoiceMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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
export function VoiceSessionWidget({ defaultOrgSlug = "urbannest" }: { defaultOrgSlug?: string }) {
  const [orgSlug, setOrgSlug] = useState(defaultOrgSlug);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState<VoiceLoopState>("idle");
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

  const speakText = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        // Force female voice: ONLY use female voices, never fall back to male
        const tag = langRef.current === "hi" ? "hi-IN" : "en-IN";
        utterance.lang = tag;
        const voices = window.speechSynthesis.getVoices();
        // Strictly prefer female voices only
        const femaleVoice =
          voices.find((v) => v.lang.replace("_", "-").toLowerCase() === tag.toLowerCase() && /female/i.test(v.name)) ??
          voices.find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(tag.slice(0, 2)) && /female/i.test(v.name));
        if (!femaleVoice) {
          // No female voice available - fail silently rather than use male voice
          resolve();
          return;
        }
        utterance.voice = femaleVoice;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
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

  const playOnce = useCallback(
    (base64: string): Promise<void> =>
      new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const player = new WavPlayer({ onEnded: finish, onError: finish });
        player.play(base64).catch(finish);
      }),
    []
  );

  /** Play AI audio with microphone muting to prevent self-hearing.
   *  Mutes mic stream before playback, unmutes after playback ends. */
  const playAudioWithMicMute = useCallback(
    (base64: string, _mimeType: string, onEnded: () => void, onError: (err: Error) => void): PlayerHandle => {
      setMicMuted(true);
      const player = new WavPlayer({
        onEnded: () => {
          setMicMuted(false);
          onEnded();
        },
        onError: (err) => {
          setMicMuted(false);
          onError(err);
        },
      });
      player.play(base64).catch(() => {
        /* onError already routed through WavPlayer */
      });
      return { stop: () => { setMicMuted(false); player.stop(); } };
    },
    [setMicMuted]
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
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        audioCtxRef.current = context;
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
      recorder.start(250);
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
      return {
        reply: String(data?.reply ?? ""),
        replyAudioBase64: data?.replyAudioBase64 ?? null,
        replyAudioMimeType: data?.replyAudioMimeType ?? null,
        transcript: data?.transcriptText ?? null,
      };
    };

    const playAudio = (
      base64: string,
      _mimeType: string,
      onEnded: () => void,
      onError: (err: Error) => void
    ): PlayerHandle => {
      const player = new WavPlayer({ onEnded, onError });
      player.play(base64).catch(() => {
        /* onError already routed through WavPlayer */
      });
      return { stop: () => player.stop() };
    };

    const speakGreeting = async (): Promise<void> => {
      if (greetedRef.current) return;
      greetedRef.current = true;
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      try {
        const response = await fetch(`/api/voice/session/${sessionId}/greet`, { method: "POST" });
        if (!response.ok) throw new Error("Greeting unavailable.");
        const data = await response.json();
        const greeting = String(data?.greeting || VOICE_GREETING_TEXT);
        pushMessage("assistant", greeting);
        if (data?.audioBase64) {
          setMicMuted(true);
          await playOnce(String(data.audioBase64));
          setMicMuted(false);
        } else {
          speakText(greeting);
        }
      } catch {
        pushMessage("assistant", VOICE_GREETING_TEXT);
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
  }, [playOnce, pushMessage, releaseMedia, speakText, stopSpeaking, playAudioWithMicMute, setMicMuted]);

  const createSession = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgSlug }),
      });
      if (!response.ok) {
        let message = `Voice is unavailable (${response.status}).`;
        try {
          const payload = await response.json();
          if (payload?.error) message = String(payload.error);
        } catch {
          /* keep default */
        }
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
  }, [controller, releaseMedia, stopSpeaking]);

  const startTextMode = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      if (!sessionIdRef.current) {
        const id = await createSession();
        if (!id) return;
      }
      greetedRef.current = false;
      await controller.startTextOnly();
    } finally {
      startingRef.current = false;
    }
  }, [controller, createSession]);

  const handleStart = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
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
  }, [controller, createSession, startTextMode]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput("");
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
    [controller, createSession, input, state]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    return () => {
      void controller.end();
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

      <div className="flex h-[420px] max-h-[70vh] flex-col bg-[#f7f8f7]">
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
              className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-[#f8faf9] px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-slate/80 focus:border-brand focus:ring-4 focus:ring-brand/10"
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