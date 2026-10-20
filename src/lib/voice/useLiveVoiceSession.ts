"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveVoiceSession,
  type LiveVoiceState,
  type LiveVoiceCallbacks,
  type LiveVoiceDeps,
  LIVE_WS_URL,
  liveModelId,
  buildLiveSetup,
  type LiveServerEvent,
  parseLiveServerMessage,
  frameToText,
  bytesToBase64,
  type LiveMicHandle,
  type LiveAudioEngine,
} from "./live-voice-session";
import { createWorkletEngine } from "./live-audio";
import { WavPlayer } from "./wav-player";
import { VOICE_GREETING_TEXT } from "./voice-greeting";

export interface UseLiveVoiceSessionOptions {
  orgSlug: string;
  language?: "en" | "hi" | "hinglish";
  onError?: (code: string, message: string) => void;
  onTranscript?: (text: string) => void;
  onReply?: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
}

export interface UseLiveVoiceSessionReturn {
  state: LiveVoiceState;
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  error: string | null;
  micStream: MediaStream | null;
  start: () => Promise<void>;
  stop: () => void;
  sendText: (text: string) => Promise<void>;
  sendAudio: (audioBase64: string, mimeType: string) => Promise<void>;
  playGreeting: () => Promise<void>;
}

function createSocket(url: string): {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
} {
  const ws = new WebSocket(url);
  return {
    send: (data: string) => ws.send(data),
    close: () => ws.close(),
    get onopen() { return ws.onopen as (() => void) | null; },
    set onopen(v) { ws.onopen = v as (this: WebSocket, ev: Event) => any; },
    get onmessage() { return ws.onmessage as ((event: { data: unknown }) => void) | null; },
    set onmessage(v) { ws.onmessage = v as (this: WebSocket, ev: MessageEvent) => any; },
    get onerror() { return ws.onerror as (() => void) | null; },
    set onerror(v) { ws.onerror = v as (this: WebSocket, ev: Event) => any; },
    get onclose() { return ws.onclose as ((event: { code: number; reason: string }) => void) | null; },
    set onclose(v) { ws.onclose = v as (this: WebSocket, ev: CloseEvent) => any; },
  };
}

function createMicFactory(): () => Promise<LiveMicHandle> {
  return async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    return {
      stream,
      stop: () => {
        stream.getTracks().forEach((track) => track.stop());
      },
    };
  };
}

function createAudioFactory(): LiveAudioEngine | null {
  return createWorkletEngine();
}

function createTokenProvider(orgSlug: string, language: string) {
  return async (): Promise<{ token: string; model: string } | null> => {
    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgSlug, language }),
      });
      const data = await res.json();
      if (!res.ok || !data.sessionId) return null;

      const tokenRes = await fetch("/api/voice/transcribe-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: data.sessionId }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.token) return null;

      return { token: tokenData.token, model: tokenData.model };
    } catch {
      return null;
    }
  };
}

export function useLiveVoiceSession(options: UseLiveVoiceSessionOptions): UseLiveVoiceSessionReturn {
  const { orgSlug, language = "en", onError, onTranscript, onReply, onInterimTranscript } = options;
  const [state, setState] = useState<LiveVoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const sessionRef = useRef<LiveVoiceSession | null>(null);
  const wavPlayerRef = useRef<WavPlayer | null>(null);
  const tokenProviderRef = useRef<() => Promise<{ token: string; model: string } | null>>();
  const sessionIdRef = useRef<string | null>(null);
  const languageRef = useRef(language);
  const greetedRef = useRef(false);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const callbacks: LiveVoiceCallbacks = useRef({
    onState: (newState: import("./live-voice-session").LiveVoiceState) => {
      setState(newState);
    },
    onFinalTranscript: (text: string) => {
      onTranscript?.(text);
    },
    onAssistantTranscript: (text: string) => {
      onReply?.(text);
    },
    onModelAudio: (base64: string) => {
      wavPlayerRef.current?.play(base64);
    },
    onToolCall: async (callId: string, transcript: string) => {
      try {
        const res = await fetch(`/api/voice/session/${encodeURIComponent(sessionIdRef.current!)}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcriptText: transcript, language: languageRef.current }),
        });
        const result = await res.json();
        if (res.ok && result.reply) {
          sessionRef.current?.answerToolCall(callId, result.reply);
        }
      } catch {
        // Error will be handled by onError
      }
    },
    onTurnComplete: () => {
      // Turn complete - continue listening automatically
    },
    onInterrupted: () => {
      wavPlayerRef.current?.stop();
    },
    onGiveUp: (message: string) => {
      setError(message);
      onError?.("provider_unavailable", message);
    },
    onGreeting: async () => {
      if (!greetedRef.current && sessionIdRef.current) {
        greetedRef.current = true;
        try {
          const res = await fetch(`/api/voice/session/${encodeURIComponent(sessionIdRef.current)}/greet`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: languageRef.current }),
          });
          const data = await res.json();
          if (res.ok && data.greeting) {
            onReply?.(data.greeting);
            if (data.audioBase64) {
              wavPlayerRef.current?.play(data.audioBase64);
            }
          }
        } catch {
          // Greeting failed - continue anyway
        }
      }
    },
  }).current;

  useEffect(() => {
    tokenProviderRef.current = createTokenProvider(orgSlug, language);

    const deps: LiveVoiceDeps = {
      socketFactory: createSocket,
      micFactory: createMicFactory(),
      audioFactory: createAudioFactory,
      tokenProvider: () => tokenProviderRef.current!(),
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };

    sessionRef.current = new LiveVoiceSession(deps, callbacks, { maxReconnects: 3 });

    // Initialize the shared WAV player here (not lazily at call sites) so the
    // cleanup below disposes the SAME instance it created. All playback call
    // sites go through wavPlayerRef, which this effect owns.
    if (!wavPlayerRef.current) {
      wavPlayerRef.current = new WavPlayer({ onEnded: () => {}, onError: () => {} });
    }
    const wavPlayer = wavPlayerRef.current;

    return () => {
      const session = sessionRef.current;
      session?.stop();
      wavPlayer?.dispose();
    };
  }, [orgSlug, language, callbacks]);

  const start = useCallback(async () => {
    setError(null);
    greetedRef.current = false;
    try {
      // Create session first
      const sessionRes = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgSlug, language: languageRef.current }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok || !sessionData.sessionId) {
        throw new Error("Failed to create voice session");
      }
      sessionIdRef.current = sessionData.sessionId;
      sessionRef.current?.getMicStream(); // This will be set after mic starts
      await sessionRef.current?.start(languageRef.current);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start voice session";
      setError(message);
      onError?.("provider_unavailable", message);
    }
  }, [orgSlug, onError]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    wavPlayerRef.current?.stop();
    setMicStream(null);
    greetedRef.current = false;
  }, []);

  const sendText = useCallback(async (text: string) => {
    if (!sessionIdRef.current) return;
    try {
      const res = await fetch(`/api/voice/session/${encodeURIComponent(sessionIdRef.current)}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptText: text, language: languageRef.current }),
      });
      const result = await res.json();
      if (res.ok && result.reply) {
        onReply?.(result.reply);
        if (result.replyAudioBase64) {
          sessionRef.current?.setMuted(true);
          wavPlayerRef.current?.play(result.replyAudioBase64).finally(() => {
            sessionRef.current?.setMuted(false);
          });
        }
      }
    } catch {
      // Error handled by UI
    }
  }, [onReply]);

  const sendAudio = useCallback(async (audioBase64: string, mimeType: string) => {
    if (!sessionIdRef.current) return;
    try {
      const res = await fetch(`/api/voice/session/${encodeURIComponent(sessionIdRef.current)}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, audioMimeType: mimeType, language: languageRef.current }),
      });
      const result = await res.json();
      if (res.ok && result.reply) {
        onReply?.(result.reply);
        if (result.replyAudioBase64) {
          sessionRef.current?.setMuted(true);
          wavPlayerRef.current?.play(result.replyAudioBase64).finally(() => {
            sessionRef.current?.setMuted(false);
          });
        }
      }
    } catch {
      // Error handled by UI
    }
  }, [onReply]);

  const playGreeting = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      const res = await fetch(`/api/voice/session/${encodeURIComponent(sessionIdRef.current)}/greet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: languageRef.current }),
      });
      const data = await res.json();
      if (res.ok && data.greeting) {
        onReply?.(data.greeting);
        if (data.audioBase64) {
          sessionRef.current?.setMuted(true);
          wavPlayerRef.current?.play(data.audioBase64).finally(() => {
            sessionRef.current?.setMuted(false);
          });
        }
      }
    } catch {
      // Greeting failed - continue anyway
    }
  }, [onReply]);

  // Update mic stream for visualizer
  useEffect(() => {
    const interval = setInterval(() => {
      const stream = sessionRef.current?.getMicStream() as MediaStream | null;
      if (stream !== micStream) {
        setMicStream(stream);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [micStream]);

  return {
    state,
    isConnected: state === "listening" || state === "speaking" || state === "processing",
    isListening: state === "listening",
    isSpeaking: state === "speaking",
    error,
    micStream,
    start,
    stop,
    sendText,
    sendAudio,
    playGreeting,
  };
}