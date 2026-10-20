import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

/**
 * SHARED ABUSE PROTECTION (Batch 1B-1 limits, Batch 6 distributed store).
 *
 * Storage abstraction with two backends behind one API:
 * - LOCAL (default): the original in-memory fixed-window store. Used
 *   whenever Upstash credentials are absent, so local development works
 *   with zero infrastructure.
 * - DISTRIBUTED (Upstash Redis over HTTPS): used automatically when
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.Counting is a
 *   single atomic server-side EVAL per check, so N app instances share one
 *   budget and concurrent requests cannot bypass limits.
 *
 * DEPLOYMENT ASSUMPTIONS:
 * 1. TRUSTED EDGE: getClientIp() assumes at least one reverse proxy / edge
 *    that APPENDS the real client address to X-Forwarded-For. It keys on the
 *    LAST XFF entry and ignores client-controlled prefixes. Direct
 *    connections make XFF fully spoofable — acceptable for dev, NOT prod.
 * 2. PRODUCTION: set the Upstash vars AND RATE_LIMIT_REQUIRE_REDIS=true.
 *    When distributed protection is active, a Redis failure (or a required
 *    but missing configuration) FAILS CLOSED (denies) on these
 *    security-sensitive limiters. The local in-memory fallback fails open
 *    only because there is nothing safer available in that mode.
 * 3. SERVER-NODE ONLY: this module uses node:crypto and must stay out of
 *    client bundles and edge middleware (all current consumers are
 *    server-side route handlers / auth).
 */

const MAX_TRACKED_KEYS = 20000;

export interface BucketLimit {
  windowMs: number;
  max: number;
}

export interface LimitCheck {
  allowed: boolean;
  /** Milliseconds until the current window resets (for Retry-After). */
  retryAfterMs: number;
}

// ---------------------------------------------------------------------------
// Storage abstraction
// ---------------------------------------------------------------------------

/** Single-round-trip atomic increment. Implementations must be safe under
 *  concurrent increments from many processes. */
export interface RateLimitStore {
  increment(key: string, windowMs: number, now?: number): Promise<{ count: number; resetAfterMs: number }>;
  reset(key: string): Promise<void>;
}

interface MemoryBucket {
  count: number;
  windowStart: number;
}

/** Original Batch 1B-1 in-memory fixed-window store (local/dev fallback). */
export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, MemoryBucket>();

  private prune(now: number, windowMs: number) {
    this.store.forEach((bucket, key) => {
      if (now - bucket.windowStart > windowMs) this.store.delete(key);
    });
    while (this.store.size > MAX_TRACKED_KEYS) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  async increment(key: string, windowMs: number, now: number = Date.now()) {
    const safeKey = key.slice(0, 200);
    this.prune(now, windowMs);
    const bucket = this.store.get(safeKey);
    if (!bucket || now - bucket.windowStart > windowMs) {
      this.store.set(safeKey, { count: 1, windowStart: now });
      return { count: 1, resetAfterMs: windowMs };
    }
    bucket.count += 1;
    return { count: bucket.count, resetAfterMs: Math.max(0, bucket.windowStart + windowMs - now) };
  }

  async reset(key: string) {
    this.store.delete(key.slice(0, 200));
  }
}

export interface UpstashConfig {
  url: string;
  token: string;
}

/** Reads Upstash credentials. Both variables required; values never logged. */
export function getUpstashConfig(): UpstashConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

/** Explicit operator opt-in: distributed protection is mandatory. */
export function isRedisRequired(): boolean {
  return process.env.RATE_LIMIT_REQUIRE_REDIS === "true";
}

// Atomic fixed-window increment. INCR + conditional PEXPIRE + PTTL happen
// inside ONE server-side script, so concurrent check() calls from any
// number of instances serialize on the key — no GET-then-SET race.
const WINDOW_EVAL_SCRIPT = `local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}`;

const UPSTASH_TIMEOUT_MS = 2000;

export type UpstashFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Upstash Redis over HTTPS. No new dependencies: uses global fetch. */
export class UpstashRateLimitStore implements RateLimitStore {
  constructor(
    private config: UpstashConfig,
    private fetchFn: UpstashFetch = fetch as unknown as UpstashFetch
  ) {}

  private async command(args: (string | number)[]): Promise<unknown> {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS) : null;
    try {
      const res = await this.fetchFn(`${this.config.url}/`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
      const data = (await res.json()) as { result?: unknown; error?: string };
      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new Error(`Upstash error: ${String(data.error).slice(0, 120)}`);
      }
      return data?.result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async increment(key: string, windowMs: number) {
    const result = (await this.command(["EVAL", WINDOW_EVAL_SCRIPT, 1, key, Math.max(1, Math.round(windowMs))])) as [
      number,
      number,
    ];
    const count = Number(result?.[0] ?? NaN);
    let ttl = Number(result?.[1] ?? NaN);
    if (!Number.isFinite(count)) throw new Error("Upstash returned no count");
    if (!Number.isFinite(ttl) || ttl < 0) ttl = windowMs;
    return { count, resetAfterMs: ttl };
  }

  async reset(key: string) {
    await this.command(["DEL", key]);
  }
}

/** Returned when protection is required but no usable store exists. */
class DenyAllStore implements RateLimitStore {
  async increment() {
    // Fail closed: report over-limit with a full-window retry hint.
    return { count: Number.MAX_SAFE_INTEGER, resetAfterMs: 60_000 };
  }
  async reset() {}
}

let sharedMemoryStore: MemoryRateLimitStore | null = null;
let sharedUpstashStore: UpstashRateLimitStore | null = null;

/** Resolve the process-wide store: distributed when configured, else local. */
export function resolveSharedStore(): RateLimitStore {
  const config = getUpstashConfig();
  if (config) {
    if (!sharedUpstashStore) sharedUpstashStore = new UpstashRateLimitStore(config);
    return sharedUpstashStore;
  }
  if (isRedisRequired()) return new DenyAllStore();
  if (!sharedMemoryStore) sharedMemoryStore = new MemoryRateLimitStore();
  return sharedMemoryStore;
}

/** SHA-256 hex for key hygiene (sync, server-node only — see header). */
function sha256hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Storage key. Format: basera:rl:<limiter>:<sha256(identifier)[:32]>:<windowMs>
 * Raw emails, tokens, IPs, and conversation IDs never reach Redis — only a
 * truncated hash plus the limiter name and window. Bounded and deterministic.
 */
export function buildStorageKey(limiterName: string, identifier: string, windowMs: number): string {
  const safeName = limiterName.replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "default";
  return `basera:rl:${safeName}:${sha256hex(identifier).slice(0, 32)}:${windowMs}`;
}

export function createRateLimiter(limit: BucketLimit, name = "default", store?: RateLimitStore) {
  const activeStore = store ?? resolveSharedStore();

  async function check(key: string, now: number = Date.now()): Promise<LimitCheck> {
    try {
      const { count, resetAfterMs } = await activeStore.increment(buildStorageKey(name, key, limit.windowMs), limit.windowMs, now);
      if (count > limit.max) return { allowed: false, retryAfterMs: resetAfterMs };
      return { allowed: true, retryAfterMs: 0 };
    } catch {
      // Fail CLOSED when distributed protection backs this limiter;
      // fail open only for the local in-memory fallback.
      if (activeStore instanceof UpstashRateLimitStore || activeStore instanceof DenyAllStore) {
        return { allowed: false, retryAfterMs: 60_000 };
      }
      return { allowed: true, retryAfterMs: 0 };
    }
  }

  async function reset(key: string) {
    try {
      await activeStore.reset(buildStorageKey(name, key, limit.windowMs));
    } catch {
      // Reset is best-effort (post-login cleanup); never break auth on it.
    }
  }

  return { check, reset };
}

/** Normalize one raw IP-ish value: trim, lowercase, strip brackets, bound length. */
function normalizeIp(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "").slice(0, 64) || "unknown";
}

/**
 * Extract the best-effort client IP from request headers.
 * Prefers the LAST X-Forwarded-For entry (appended nearest our server —
 * the first entries are client-controlled and untrusted), then X-Real-IP.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter((part) => part && part.toLowerCase() !== "unknown");
    if (parts.length > 0) return normalizeIp(parts[parts.length - 1]);
  }
  const realIp = headers.get("x-real-ip");
  if (realIp && realIp.trim()) return normalizeIp(realIp);
  return "unknown";
}

/** Build a Headers object from a NextAuth-style req (web Headers or Node header map). */
export function headersFromReq(req: unknown): Headers {
  try {
    const raw = (req as { headers?: unknown })?.headers;
    if (raw instanceof Headers) return raw;
    const out = new Headers();
    if (raw && typeof raw === "object") {
      for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(value)) out.set(name, value.join(", "));
        else if (value != null) out.set(name, String(value));
      }
    }
    return out;
  } catch {
    return new Headers();
  }
}

// ---------------------------------------------------------------------------
// Preset budgets — UNCHANGED from Batch 1B-1. Do not raise these without a
// security review. Windows are fixed; keyed per identifier at call sites.
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Login: per-account throttle (the important one — survives IP rotation). */
export const loginAccountLimiter = createRateLimiter({ windowMs: 15 * MINUTE, max: 10 }, "login-account");
/** Login: per-IP backstop against distributed spray from one source. */
export const loginIpLimiter = createRateLimiter({ windowMs: 15 * MINUTE, max: 60 }, "login-ip");
/** Signup: per-IP cap on workspace creation. */
export const signupIpLimiter = createRateLimiter({ windowMs: HOUR, max: 10 }, "signup-ip");
/** Forgot password: per-IP + per-email caps on reset-mail volume. */
export const forgotIpLimiter = createRateLimiter({ windowMs: HOUR, max: 30 }, "forgot-ip");
export const forgotEmailLimiter = createRateLimiter({ windowMs: HOUR, max: 5 }, "forgot-email");
/** Reset password: per-IP + per-token caps against token brute force. */
export const resetIpLimiter = createRateLimiter({ windowMs: HOUR, max: 30 }, "reset-ip");
export const resetTokenLimiter = createRateLimiter({ windowMs: HOUR, max: 10 }, "reset-token");
/** Change password (authenticated): per-user cap so a compromised session
 *  cannot brute-force the current password or spam hash computations. */
export const changePasswordUserLimiter = createRateLimiter({ windowMs: 15 * MINUTE, max: 5 }, "change-password-user");

/** Two-factor login: password-check step (challenge creation) gets its own
 *  per-IP budget so it never eats into the sign-in IP budget; the per-account
 *  budget is SHARED with loginAccountLimiter (same key) so password guessing
 *  through either entry point draws down one pool. */
export const twoFactorChallengeIpLimiter = createRateLimiter({ windowMs: 15 * MINUTE, max: 60 }, "two-factor-challenge-ip");
/** Two-factor verify: per-IP cap on code attempts (recovery/TOTP). */
export const twoFactorVerifyIpLimiter = createRateLimiter({ windowMs: 15 * MINUTE, max: 40 }, "two-factor-verify-ip");
/** Two-factor verify: per-challenge cap — 5 tries of a 6-digit code (with
 *  ±1 step drift that's 3 valid values in 1,000,000) is already ~0.0003%
 *  odds; beyond that the challenge locks until a fresh login starts. */
export const twoFactorVerifyChallengeLimiter = createRateLimiter({ windowMs: 15 * MINUTE, max: 5 }, "two-factor-verify-challenge");
/** Two-factor enrollment: per-user caps on setup/enable/disable calls. */
export const twoFactorSetupUserLimiter = createRateLimiter({ windowMs: 15 * MINUTE, max: 10 }, "two-factor-setup-user");
export const twoFactorEnableUserLimiter = createRateLimiter({ windowMs: 15 * MINUTE, max: 5 }, "two-factor-enable-user");
/** Email verification (Batch 1B-3): verify attempts + resend volume. */
export const verifyEmailLimiter = createRateLimiter({ windowMs: HOUR, max: 30 }, "verify-ip");
export const verifyTokenLimiter = createRateLimiter({ windowMs: HOUR, max: 10 }, "verify-token");
export const verifyResendIpLimiter = createRateLimiter({ windowMs: HOUR, max: 30 }, "verify-resend-ip");
export const verifyResendEmailLimiter = createRateLimiter({ windowMs: HOUR, max: 5 }, "verify-resend-email");

/** Public chat: per-IP burst + daily budgets. */
export const chatIpMinuteLimiter = createRateLimiter({ windowMs: MINUTE, max: 30 }, "chat-ip-minute");
export const chatIpDayLimiter = createRateLimiter({ windowMs: DAY, max: 400 }, "chat-ip-day");
/** Public chat: new conversation (lead) farming cap per IP per day. */
export const chatNewConversationLimiter = createRateLimiter({ windowMs: DAY, max: 15 }, "chat-new-convo");
/** Public chat: turns per conversation per day (AI-cost ceiling per thread). */
export const chatConversationTurnLimiter = createRateLimiter({ windowMs: DAY, max: 60 }, "chat-turns");

/** Public voice (Phase 1): own buckets so voice abuse budgets never eat
 *  into website-chat budgets or vice versa. Same shape as chat limits. */
export const voiceIpMinuteLimiter = createRateLimiter({ windowMs: MINUTE, max: 30 }, "voice-ip-minute");
export const voiceIpDayLimiter = createRateLimiter({ windowMs: DAY, max: 400 }, "voice-ip-day");
/** Public voice: new voice-session (lead) farming cap per IP per day. */
export const voiceNewSessionLimiter = createRateLimiter({ windowMs: DAY, max: 15 }, "voice-new-session");
/** Public voice: turns per voice session per day (AI-cost ceiling per session). */
export const voiceSessionTurnLimiter = createRateLimiter({ windowMs: DAY, max: 60 }, "voice-turns");

/** Generic 429 response. Reveals nothing about accounts, limits, or internals. */
export function rateLimitedResponse(retryAfterMs = 0): NextResponse {
  const res = NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429 }
  );
  if (retryAfterMs > 0) res.headers.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  return res;
}

/** Knowledge API: moderate limits for document ops and retrieval */
export const knowledgeApiLimiter = createRateLimiter({ windowMs: MINUTE, max: 60 }, "knowledge-api");

/**
 * Staff collection/detail reads: generous per-user budget (120/min) that
 * routine CRM use never notices but blunts list-scraping and accidental
 * polling storms. Keyed by the server-side authenticated user id (never
 * client input). Store is Upstash Redis when configured, otherwise
 * per-process memory — see the deployment note in the report.
 */
export const staffApiLimiter = createRateLimiter({ windowMs: MINUTE, max: 120 }, "staff-api");

/**
 * Public property media delivery (images + video + HTTP range requests).
 * Generous per-IP budget so normal gallery loads and video seeking are
 * unaffected, but bounded to blunt scraping/hotlink abuse. Media is public
 * by design (it appears on anonymous listings).
 */
export const mediaApiLimiter = createRateLimiter({ windowMs: MINUTE, max: 1200 }, "media-api");
