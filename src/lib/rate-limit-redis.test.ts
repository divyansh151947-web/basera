import { describe, expect, it, afterEach } from "vitest";

import {
  UpstashRateLimitStore,
  MemoryRateLimitStore,
  buildStorageKey,
  createRateLimiter,
  getUpstashConfig,
  isRedisRequired,
  resolveSharedStore,
  type UpstashFetch,
} from "./rate-limit";

const SAVED_ENV = {
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  require: process.env.RATE_LIMIT_REQUIRE_REDIS,
};

afterEach(() => {
  if (SAVED_ENV.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = SAVED_ENV.url;
  if (SAVED_ENV.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = SAVED_ENV.token;
  if (SAVED_ENV.require === undefined) delete process.env.RATE_LIMIT_REQUIRE_REDIS;
  else process.env.RATE_LIMIT_REQUIRE_REDIS = SAVED_ENV.require;
});

/** Minimal in-test fake of the Upstash REST surface for one EVAL shape. */
function fakeUpstash() {
  const counts = new Map<string, { count: number; expiresAt: number }>();
  const calls: Array<{ url: string; body: unknown }> = [];
  const now = { t: 1_000_000 };
  const fetchFn: UpstashFetch = async (url, init) => {
    const body = JSON.parse(init.body) as unknown[];
    calls.push({ url, body });
    const [, , numkeys, key, windowMs] = body as [string, string, number, string, number];
    void numkeys;
    const entry = counts.get(key);
    if (!entry || now.t >= entry.expiresAt) {
      counts.set(key, { count: 1, expiresAt: now.t + Number(windowMs) });
      return { ok: true, status: 200, json: async () => ({ result: [1, Number(windowMs)] }) };
    }
    entry.count += 1;
    return { ok: true, status: 200, json: async () => ({ result: [entry.count, entry.expiresAt - now.t] }) };
  };
  return { calls, now, fetchFn };
}

describe("storage key design", () => {
  it("uses a namespaced, bounded key with no raw secrets", () => {
    const key = buildStorageKey("login-account", "victim@example.com", 900_000);
    expect(key.startsWith("basera:rl:login-account:")).toBe(true);
    expect(key.endsWith(":900000")).toBe(true);
    expect(key).not.toContain("victim");
    expect(key).not.toContain("@");
    expect(key.length).toBeLessThan(120);
  });

  it("is deterministic and separates limiters, identifiers, windows", () => {
    expect(buildStorageKey("a", "x", 1)).toBe(buildStorageKey("a", "x", 1));
    expect(buildStorageKey("a", "x", 1)).not.toBe(buildStorageKey("a", "y", 1));
    expect(buildStorageKey("a", "x", 1)).not.toBe(buildStorageKey("b", "x", 1));
    expect(buildStorageKey("a", "x", 1)).not.toBe(buildStorageKey("a", "x", 2));
  });

  it("sanitizes hostile limiter names", () => {
    expect(buildStorageKey("../../etc", "x", 1)).not.toContain("..");
  });
});

describe("Upstash configuration detection", () => {
  it("returns null without credentials (local dev)", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(getUpstashConfig()).toBeNull();
    expect(isRedisRequired()).toBe(false);
  });

  it("requires both URL and token", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(getUpstashConfig()).toBeNull();
    process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    expect(getUpstashConfig()).toEqual({ url: "https://example.upstash.io", token: "tok" });
  });

  it("require-flag defaults off and reads explicit opt-in", () => {
    expect(isRedisRequired()).toBe(false);
    process.env.RATE_LIMIT_REQUIRE_REDIS = "true";
    expect(isRedisRequired()).toBe(true);
  });
});

describe("Upstash adapter behavior (mocked transport)", () => {
  it("increments, expires, and blocks past max", async () => {
    const fake = fakeUpstash();
    const store = new UpstashRateLimitStore({ url: "https://x.upstash.io", token: "t" }, fake.fetchFn);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 }, "test-upstash", store);
    expect((await limiter.check("user-1")).allowed).toBe(true);
    expect((await limiter.check("user-1")).allowed).toBe(true);
    const blocked = await limiter.check("user-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect((await limiter.check("user-2")).allowed).toBe(true);
  });

  it("issues exactly one atomic round-trip per check (no GET-then-SET)", async () => {
    const fake = fakeUpstash();
    const store = new UpstashRateLimitStore({ url: "https://x.upstash.io", token: "t" }, fake.fetchFn);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 100 }, "atomic", store);
    await limiter.check("k");
    await limiter.check("k");
    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      const body = call.body as unknown[];
      expect(body[0]).toBe("EVAL");
      expect(String(body[1])).toContain("INCR");
      // One key, one atomic script — concurrent instances serialize on it.
      expect(body[3]).toBeDefined();
    }
  });

  it("sends the bearer token and never the raw identifier in clear", async () => {
    const fake = fakeUpstash();
    let seenAuth = "";
    const spy: UpstashFetch = async (url, init) => {
      seenAuth = init.headers["authorization"] ?? "";
      return fake.fetchFn(url, init);
    };
    const store = new UpstashRateLimitStore({ url: "https://x.upstash.io", token: "super-secret-token" }, spy);
    await createRateLimiter({ windowMs: 60_000, max: 5 }, "authz", store).check("someone@example.com");
    expect(seenAuth).toBe("Bearer super-secret-token");
    const sentKey = (fake.calls[0].body as unknown[])[3] as string;
    expect(sentKey).not.toContain("someone@example.com");
  });

  it("reset() issues a DEL for the same storage key", async () => {
    const fake = fakeUpstash();
    const store = new UpstashRateLimitStore({ url: "https://x.upstash.io", token: "t" }, fake.fetchFn);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 }, "del-test", store);
    await limiter.check("k");
    await limiter.reset("k");
    const last = fake.calls[fake.calls.length - 1].body as unknown[];
    expect(last[0]).toBe("DEL");
  });
});

describe("failure behavior", () => {
  it("fails CLOSED when distributed Redis errors", async () => {
    const failing: UpstashFetch = async () => {
      throw new Error("connection refused");
    };
    const store = new UpstashRateLimitStore({ url: "https://x.upstash.io", token: "t" }, failing);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 100 }, "fail-closed", store);
    const result = await limiter.check("anyone");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("fails CLOSED on malformed Upstash responses", async () => {
    const bad: UpstashFetch = async () => ({ ok: true, status: 200, json: async () => ({ result: null }) });
    const store = new UpstashRateLimitStore({ url: "https://x.upstash.io", token: "t" }, bad);
    expect((await createRateLimiter({ windowMs: 60_000, max: 100 }, "bad-resp", store).check("k")).allowed).toBe(false);
  });

  it("fails CLOSED on Upstash HTTP errors", async () => {
    const down: UpstashFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const store = new UpstashRateLimitStore({ url: "https://x.upstash.io", token: "t" }, down);
    expect((await createRateLimiter({ windowMs: 60_000, max: 100 }, "http-err", store).check("k")).allowed).toBe(false);
  });

  it("local memory fallback still fails open on internal errors (dev safety)", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 }, "mem-fallback", store);
    expect((await limiter.check("k", 0)).allowed).toBe(true);
  });

  it("required-but-unconfigured Redis denies everything (no silent bypass)", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.RATE_LIMIT_REQUIRE_REDIS = "true";
    const store = resolveSharedStore();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 10_000 }, "required-missing", store);
    expect((await limiter.check("anyone")).allowed).toBe(false);
  });

  it("unconfigured + not required resolves to the local fallback", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.RATE_LIMIT_REQUIRE_REDIS;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5 }, `local-${Date.now()}`);
    expect((await limiter.check("k")).allowed).toBe(true);
  });
});
