import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { voiceSessions } from "@/db/schema";
import { createLead, getLeadById } from "@/lib/data/leads";
import {
  getConversation,
  getOrCreateConversationForLead,
  getMessages,
} from "@/lib/data/conversations";
import { processInboundMessage } from "@/lib/ai/conversation-agent";
import {
  getVoiceProviderName,
  isVoiceLanguage,
  type VoiceLanguage,
  type VoiceProvider,
} from "./voice-provider";
import { MockVoiceProvider } from "./mock-voice-provider";
import { detectLanguageSwitch } from "./voice-greeting";
import { OPENAI_VOICE_PROVIDER_ID, openAIVoiceIsConfigured, OpenAIVoiceProvider } from "./openai-voice-provider";
import { GEMINI_VOICE_PROVIDER_ID, geminiVoiceIsConfigured, GeminiVoiceProvider } from "./gemini-voice-provider";
import { GEMINI_TTS_PROVIDER_ID, geminiTtsIsConfigured } from "./gemini-tts-provider";
import { KOKORO_VOICE_PROVIDER_ID, kokoroIsConfigured, KokoroVoiceProvider } from "./kokoro-voice-provider";
import { detectVoiceLanguage, localizeVoicePrompt, toReplyLanguage } from "@/lib/ai/voice-language";
import {
  detectVoiceAction,
  voiceActionConfirmation,
  type VoiceClientAction,
} from "@/lib/ai/tour-navigation";
import { buildVoiceDataAnswer, detectVoiceDataIntent } from "@/lib/ai/voice-data-answers";

/**
 * VOICE SESSIONS (Voice AI Phase 1).
 *
 * A voice session is a THIN VIEW over the existing lead/conversation
 * architecture — not a parallel database. Durable state (lead fields,
 * messages, scores, matches, appointments) lives in the standard rows with
 * channel VOICE (new threads) or with VOICE message metadata (continued
 * threads); the voice_sessions table holds only session bookkeeping
 * (status/turns/timing) so sessions survive across requests, restarts, and
 * (later) instances. Module-level memory is deliberately NOT used for
 * session state: it does not survive across Next.js route compilations in
 * this setup (verified live), so it cannot back even Phase 1.
 *
 * Every turn reuses the existing AI pipeline end-to-end via
 * processInboundMessage: extraction → qualification → matching → scoring →
 * handoff. Voice adds no brain; it adds a channel.
 */

export type VoiceSessionStatus = "ACTIVE" | "ENDED";

export interface VoiceSession {
  id: string;
  organizationId: string;
  leadId: string;
  conversationId: string;
  /** Original thread channel; voice may continue any existing thread. */
  conversationChannel: string;
  language: VoiceLanguage;
  providerId: string;
  mock: boolean;
  status: VoiceSessionStatus;
  turns: number;
  startedAt: string;
  endedAt: string | null;
}

export interface StartVoiceSessionInput {
  organizationId: string;
  leadId?: string | null;
  conversationId?: string | null;
  language?: unknown;
}

export interface VoiceTurnInput {
  sessionId: string;
  transcriptText: string;
  language?: unknown;
  /** Phase 2: browser-captured audio; transcribed server-side by the live
   *  provider before entering the standard pipeline. Never stored. */
  audioBase64?: string | null;
  audioMimeType?: string | null;
}

export interface VoiceTurnResult {
  sessionId: string;
  transcriptText: string;
  language: VoiceLanguage;
  reply: string;
  mock: boolean;
  processingNote: string;
  /** Live-provider reply audio (base64 MP3); null in mock mode. */
  replyAudioBase64: string | null;
  replyAudioMimeType: string | null;
  /** Safe client action for the turn (app/tour navigation, back, or a
   *  destructive-action confirmation request). Null for pure conversation.
   *  Executed client-side from a fixed allowlist — never a model URL. */
  voiceAction: VoiceClientAction | null;
  turns: number;
  leadId: string;
  conversationId: string;
  conversationStatus: string;
  /** Provider telemetry for the turn (model/voice/latency; ttsMissed when
   *  synthesis failed and the text reply stands alone). Result object only. */
  providerMetadata: Record<string, unknown>;
}

export interface VoiceSessionSummary {
  sessionId: string;
  status: VoiceSessionStatus;
  turns: number;
  leadId: string;
  conversationId: string;
  startedAt: string;
  endedAt: string | null;
  outcome: string;
}

async function resolveProvider(): Promise<VoiceProvider> {
  return createProviderById(getVoiceProviderName());
}

/**
 * Build a provider by EXPLICIT id (session-stored, not env-derived). Used
 * by the greet path so a mid-session env change can never silently switch
 * vendors under an active conversation. Same fail-closed rules as resolve.
 */
export async function createProviderById(providerId: string): Promise<VoiceProvider> {
  if (providerId === "mock") return new MockVoiceProvider();
  // Live providers are explicit and independent: OpenAI (premium, full
  // voice turns), Gemini (low-cost/free-tier STT + TTS), and Kokoro (opt-in
  // self-hosted TTS). Anything else — and either live provider without its
  // configuration — fails closed. Providers NEVER fall back to each other
  // (that would create surprise API costs).
  if (providerId === OPENAI_VOICE_PROVIDER_ID) {
    if (!openAIVoiceIsConfigured()) {
      throw new Error(`Voice provider "${providerId}" is not configured.`);
    }
    return new OpenAIVoiceProvider();
  }
  if (providerId === GEMINI_VOICE_PROVIDER_ID) {
    if (!geminiVoiceIsConfigured()) {
      throw new Error(`Voice provider "${providerId}" is not configured.`);
    }
    return new GeminiVoiceProvider();
  }
  if (providerId === GEMINI_TTS_PROVIDER_ID) {
    if (!geminiTtsIsConfigured()) {
      throw new Error(`Voice provider "${providerId}" is not configured.`);
    }
    const { GeminiTtsProvider } = await import("./gemini-tts-provider");
    return new GeminiTtsProvider();
  }
  if (providerId === KOKORO_VOICE_PROVIDER_ID) {
    if (!kokoroIsConfigured()) {
      throw new Error(`Voice provider "${providerId}" is not configured.`);
    }
    return new KokoroVoiceProvider();
  }
  throw new Error(`Voice provider "${providerId}" is not configured.`);
}

function resolveLanguage(value: unknown): VoiceLanguage {
  return isVoiceLanguage(value) ? value : "en";
}

function toSession(row: typeof voiceSessions.$inferSelect): VoiceSession {
  return {
    id: row.id,
    organizationId: row.organizationId,
    leadId: row.leadId,
    conversationId: row.conversationId,
    conversationChannel: row.conversationChannel,
    language: isVoiceLanguage(row.language) ? row.language : "en",
    providerId: row.providerId,
    mock: row.isMock,
    status: row.status === "ENDED" ? "ENDED" : "ACTIVE",
    turns: row.turns,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

/** Start (or attach) a voice session. Reuses an existing lead/conversation
 *  when ids are given (channel continuity); otherwise creates a VOICE lead
 *  and VOICE thread. Invalid/cross-tenant references are rejected. */
export async function startVoiceSession(input: StartVoiceSessionInput): Promise<VoiceSession> {
  const provider = await resolveProvider();
  const language = resolveLanguage(input.language);

  let leadId = input.leadId ?? null;
  let conversationId = input.conversationId ?? null;
  let conversationChannel = "VOICE";

  if (conversationId) {
    const conversation = await getConversation(input.organizationId, conversationId);
    if (!conversation) throw new Error("Voice conversation not found.");
    if (leadId && conversation.leadId !== leadId) {
      throw new Error("Voice conversation does not belong to this lead.");
    }
    leadId = conversation.leadId;
    conversationChannel = conversation.channel;
  } else if (leadId) {
    const lead = await getLeadById(input.organizationId, leadId);
    if (!lead) throw new Error("Voice lead not found.");
    const conversation = await getOrCreateConversationForLead(input.organizationId, leadId, "VOICE");
    conversationId = conversation.id;
    conversationChannel = conversation.channel;
  } else {
    const lead = await createLead(input.organizationId, { source: "VOICE" });
    leadId = lead.id;
    const conversation = await getOrCreateConversationForLead(input.organizationId, leadId, "VOICE");
    conversationId = conversation.id;
    conversationChannel = conversation.channel;
  }

  const now = new Date().toISOString();
  const [row] = await db
    .insert(voiceSessions)
    .values({
      id: `vs_${crypto.randomUUID()}`,
      organizationId: input.organizationId,
      leadId,
      conversationId,
      conversationChannel,
      language,
      providerId: provider.id,
      isMock: provider.mode === "mock",
      status: "ACTIVE",
      turns: 0,
      startedAt: now,
      endedAt: null,
      updatedAt: now,
    })
    .returning();
  return toSession(row);
}

/** Look up a session (throws on unknown id — routes map to 404). */
export async function getVoiceSessionOrThrow(sessionId: string): Promise<VoiceSession> {
  const rows = await db.select().from(voiceSessions).where(eq(voiceSessions.id, sessionId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("Voice session not found.");
  return toSession(row);
}

/** Disambiguate numbers in transcript using conversation context.
 *  Example: last AI asked "How many BHK?" → user says "two" → "2 BHK".
 *  Last AI asked "What's your budget?" → user says "two" → "2 lakh".
 *  Also handles Hindi/Hinglish number words and Indian money formats. */
async function disambiguateTranscript(
  transcript: string,
  conversationId: string
): Promise<string> {
  const msgs = await getMessages(conversationId);
  if (msgs.length === 0) return transcript;

  // Find last AI message
  let lastAi = "";
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].sender === "AI" && typeof msgs[i].content === "string") {
      lastAi = msgs[i].content.toLowerCase();
      break;
    }
  }
  if (!lastAi) return transcript;

  const t = transcript.trim().toLowerCase();
  
  // Hindi/English number words mapping
  const wordToNum: Record<string, string> = {
    // English
    one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
    eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
    sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
    thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100",
    // Hindi (roman)
    ek: "1", do: "2", teen: "3", chaar: "4", paanch: "5", panch: "5",
    chhah: "6", saat: "7", aath: "8", nau: "9", das: "10",
    gyarah: "11", barah: "12", terah: "14", chauda: "14", pandrah: "15",
    solah: "16", satrah: "17", atharah: "18", unnees: "19", bees: "20",
    tees: "30", chaalis: "40", pachaas: "50", saath: "60", sattar: "70", assi: "80", nabbe: "90", sau: "100",
    // Hindi (Devanagari) - will match via tokenization
  };

  // Check for already clear patterns: "2 BHK", "80 lakh", "3 crore", etc.
  const numberWithBhk = /^(one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|chaar|paanch|panch|chhah|saat|aath|nau|das|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20)\s*bhk$/i.test(t);
  const numberWithLakh = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|ek|do|teen|chaar|paanch|panch|chhah|saat|aath|nau|das|gyarah|barah|terah|chauda|pandrah|solah|satrah|atharah|unnees|bees|tees|chaalis|pachaas|saath|sattar|assi|nabbe|sau|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|30|40|50|60|70|80|90|100)\s*(lakh|lac|lacs|lakhs|लाख|लाखों)$/i.test(t);
  const numberWithCrore = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|ek|do|teen|chaar|paanch|panch|chhah|saat|aath|nau|das|gyarah|barah|terah|chauda|pandrah|solah|satrah|atharah|unnees|bees|tees|chaalis|pachaas|saath|sattar|assi|nabbe|sau|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|30|40|50|60|70|80|90|100)\s*(crore|crores|करोड़|करोड़ों)$/i.test(t);
  
  // Also check for "X lakh Y" patterns like "80 lakh hai", "budget 3 crore"
  const lakhInContext = /(lakh|lac|lacs|lakhs|लाख|लाखों)/i.test(t);
  const croreInContext = /(crore|crores|करोड़|करोड़ों)/i.test(t);
  const bhkInContext = /bhk/i.test(t);

  // Already clear: "2 BHK", "80 lakh", "3 crore", etc.
  if (numberWithBhk || numberWithLakh || numberWithCrore) return transcript;

  // Context: AI asked about BHK/bedrooms
  const askedBhk = /bhk|bedroom|bed\s*room|how many (bed|room)/i.test(lastAi);
  // Context: AI asked about budget/price
  const askedBudget = /budget|price|cost|afford|spend|maximum|minimum|range/i.test(lastAi);
  // Context: AI asked about city/location
  const askedCity = /city|area|location|where|which\s*(city|area)/i.test(lastAi);

  // Extract number from transcript
  let extractedNum: string | null = null;
  
  // Try to match number words first (both English and Hindi roman)
  for (const [word, num] of Object.entries(wordToNum)) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(t)) {
      extractedNum = num;
      break;
    }
  }
  
  // Try digits
  if (!extractedNum) {
    const digitMatch = t.match(/\b(\d+)\b/);
    if (digitMatch) extractedNum = digitMatch[1];
  }

  // If we found a bare number, disambiguate based on context
  if (extractedNum) {
    // If transcript already has lakh/crore/bhk, don't modify
    if (lakhInContext || croreInContext || bhkInContext) {
      return transcript;
    }
    
    // Check if transcript is a bare number (just a number word or digit without units)
    const isBareNumber = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|ek|do|teen|chaar|paanch|panch|chhah|saat|aath|nau|das|gyarah|barah|terah|chauda|pandrah|solah|satrah|atharah|unnees|bees|tees|chaalis|pachaas|saath|sattar|assi|nabbe|sau|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|30|40|50|60|70|80|90|100)$/i.test(t);
    
    if (isBareNumber) {
      if (askedBhk && !askedBudget) return transcript.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|chaar|paanch|panch|chhah|saat|aath|nau|das|\d+)\b/i, `${extractedNum} BHK`);
      if (askedBudget && !askedBhk) return transcript.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|chaar|paanch|panch|chhah|saat|aath|nau|das|\d+)\b/i, `${extractedNum} lakh`);
      // If both or neither, don't guess — return as-is
    }
  }

  // Handle "X lakh" or "X crore" when number is in transcript but unit missing
  // e.g., "budget 80" when AI asked about budget -> "budget 80 lakh"
  if (askedBudget && !askedBhk && extractedNum && !lakhInContext && !croreInContext) {
    const num = parseInt(extractedNum, 10);
    if (num >= 1 && num <= 10) {
      // Small numbers in budget context usually mean crore
      return transcript.replace(new RegExp(`\\b${extractedNum}\\b`), `${extractedNum} crore`);
    } else if (num >= 20 && num <= 100) {
      // Medium numbers usually mean lakh
      return transcript.replace(new RegExp(`\\b${extractedNum}\\b`), `${extractedNum} lakh`);
    }
  }

  return transcript;
}

/** One voice turn: transcript → provider passthrough → existing Basera AI
 *  → reply text (+ mock synthesis note). The reply comes from the SAME
 *  pipeline as website/WhatsApp; nothing is reimplemented here. */
export async function voiceTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
  const provider = await resolveProvider();
  const session = await getVoiceSessionOrThrow(input.sessionId);
  if (session.status !== "ACTIVE") throw new Error("Voice session has ended.");
  if (provider.id !== session.providerId) throw new Error("Voice provider mismatch.");

  const prepared = await provider.prepareTurn({
    transcriptText: input.transcriptText,
    language: resolveLanguage(input.language ?? session.language),
    conversationId: session.conversationId,
    leadId: session.leadId,
    audioBase64: input.audioBase64 ?? null,
    audioMimeType: input.audioMimeType ?? null,
  });

  // Disambiguate numbers using conversation context (e.g., "two" → "2 BHK" or "2 lakh")
  const disambiguatedTranscript = await disambiguateTranscript(prepared.transcriptText, session.conversationId);

  // Language resolution (additive layer around the unchanged pipeline):
  // explicit switches ("Hindi mein baat karo") win; otherwise the turn
  // transcript itself is auto-detected, and a confident detection persists
  // on the session row and selects this turn's synthesis voice. Low
  // confidence retains the session language (short answers like "Jaipur."
  // or "80 lakh." never flip it). No AI logic changes: the tag only routes
  // provider voice + future turn defaults.
  const switched = detectLanguageSwitch(disambiguatedTranscript);
  const auto = detectVoiceLanguage(disambiguatedTranscript, session.language === "hi" || session.language === "hinglish" ? session.language : "en");
  const turnLanguage = switched ?? (auto.confident ? auto.language : session.language);
  if (turnLanguage !== session.language) {
    await db
      .update(voiceSessions)
      .set({ language: turnLanguage, updatedAt: new Date().toISOString() })
      .where(eq(voiceSessions.id, session.id));
  }

  // Safe voice actions (app/tour navigation, destructive confirmations).
  // Detected deterministically from the transcript; the pipeline below still
  // runs unchanged so context, extraction, and scoring stay intact.
  const detectedAction = detectVoiceAction(disambiguatedTranscript);
  const voiceAction: VoiceClientAction | null = detectedAction.kind === "none" ? null : detectedAction;
  const hasAction = voiceAction != null;

  // Template language for confirmations/localization: hi/hinglish pass
  // through, everything else uses English templates. Synthesis still uses
  // the full turnLanguage tag (providers fail explicitly when unsupported).
  // Declared BEFORE the pipeline call below (it is passed as `language`).
  const replyLanguage = toReplyLanguage(turnLanguage);

  const result = await processInboundMessage(
    session.organizationId,
    session.conversationId,
    session.leadId,
    disambiguatedTranscript,
    {
      inboundMetadata: {
        channel: "VOICE",
        language: prepared.language,
        voiceSessionId: session.id,
        voiceMock: prepared.mock,
      },
      outboundMetadata: { channel: "VOICE", language: turnLanguage },
      // The AI itself generates this turn's reply in the detected language
      // (system-prompt instruction + localized templates); English callers
      // are unaffected (default "en").
      language: replyLanguage,
    }
  );

  // Localize only the known agent prompt shapes (exact match); everything
  // else passes through in the agent's own words.
  let reply = localizeVoicePrompt(result.reply, replyLanguage);

  if (hasAction) {
    // Navigation/tour/confirm turns get a short localized confirmation
    // appended to the (already localized) pipeline reply.
    const confirmation = voiceActionConfirmation(voiceAction, replyLanguage);
    if (confirmation) reply = `${reply} ${confirmation}`;
  } else {
    // Factual questions get one grounded line from the real engines,
    // appended to the pipeline reply. Null on any failure (no invention).
    const dataIntent = detectVoiceDataIntent(disambiguatedTranscript);
    if (dataIntent) {
      const dataLine = await buildVoiceDataAnswer({
        intent: dataIntent,
        organizationId: session.organizationId,
        language: replyLanguage,
      });
      if (dataLine) reply = `${reply} ${dataLine}`;
    }
  }

  // TTS is best-effort around an already-complete turn: the transcript and
  // the AI reply are persisted above and returned regardless. If synthesis
  // fails (throttling, outage), the client still shows the exact reply text
  // (spoken via its built-in fallback voice) and keeps listening, instead of
  // failing the whole turn and hiding a perfectly good answer. The miss is
  // recorded in providerMetadata — never silent, never fabricated audio.
  let synthesis: Awaited<ReturnType<VoiceProvider["synthesizeReply"]>>;
  try {
    synthesis = await provider.synthesizeReply({
      replyText: reply,
      language: turnLanguage,
      conversationId: session.conversationId,
    });
  } catch (err) {
    synthesis = {
      audioBase64: null,
      audioMimeType: null,
      mock: prepared.mock,
      processingNote: prepared.processingNote,
      providerMetadata: {
        ...(prepared.providerMetadata ?? {}),
        ttsMissed: true,
        ttsMissedReason: err instanceof Error ? err.message : "synthesis failed",
      },
    };
  }

  const conversation = await getConversation(session.organizationId, session.conversationId);
  const turns = session.turns + 1;
  await db
    .update(voiceSessions)
    .set({ turns, updatedAt: new Date().toISOString() })
    .where(and(eq(voiceSessions.id, session.id), eq(voiceSessions.status, "ACTIVE")));

  return {
    sessionId: session.id,
    transcriptText: disambiguatedTranscript,
    language: turnLanguage,
    reply,
    mock: prepared.mock,
    processingNote: prepared.processingNote,
    replyAudioBase64: synthesis.audioBase64,
    replyAudioMimeType: synthesis.audioMimeType,
    voiceAction: hasAction ? voiceAction : null,
    turns,
    leadId: session.leadId,
    conversationId: session.conversationId,
    conversationStatus: conversation?.status ?? "AI_HANDLING",
    providerMetadata: synthesis.providerMetadata,
  };
}

/** End a session. Transcript and outcomes persist in the standard rows;
 *  only the session row closes. Idempotent: ending twice keeps the first
 *  endedAt. */
export async function endVoiceSession(sessionId: string): Promise<VoiceSessionSummary> {
  const session = await getVoiceSessionOrThrow(sessionId);
  const now = new Date().toISOString();
  let endedAt = session.endedAt;
  if (session.status === "ACTIVE") {
    endedAt = now;
    await db
      .update(voiceSessions)
      .set({ status: "ENDED", endedAt: now, updatedAt: now })
      .where(and(eq(voiceSessions.id, session.id), eq(voiceSessions.status, "ACTIVE")));
  }
  const conversation = await getConversation(session.organizationId, session.conversationId);
  return {
    sessionId: session.id,
    status: "ENDED",
    turns: session.turns,
    leadId: session.leadId,
    conversationId: session.conversationId,
    startedAt: session.startedAt,
    endedAt,
    outcome: `Ended after ${session.turns} turn${session.turns === 1 ? "" : "s"}; thread status ${conversation?.status ?? "unknown"} (recorded state).`,
  };
}
