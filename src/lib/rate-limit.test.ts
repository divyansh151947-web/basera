import { describe, expect, it } from "vitest";
import {
  chatConversationTurnLimiter,
  chatNewConversationLimiter,
  createRateLimiter,
  forgotEmailLimiter,
  getClientIp,
  headersFromReq,
  loginAccountLimiter,
  rateLimitedResponse,
} from "./rate-limit";

function headers(entries: Record<string, string>) {
  return new Headers(entries);
}

describe("getClientIp: spoofed forwarded headers cannot trivially bypass limits", () => {
  it("keys on the LAST x-forwarded-for entry, ignoring attacker-controlled prefixes", () => {
    const ip = getClientIp(headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" }));
    expect(ip).toBe("9.9.9.9");
  });

  it("a lone spoofed header is still better than trusting the first entry", () => {
    // Attacker rotating the whole header gets a FRESH identity each time only
    // if they can guess rotation — but per-account/per-conversation budgets
    // (independent of IP) still bind them. The IP key itself is stable here.
    expect(getClientIp(headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(getClientIp(headers({ "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(getClientIp(headers({ "x-real-ip": "7.7.7.7" }))).toBe("7.7.7.7");
    expect(getClientIp(headers({}))).toBe("unknown");
  });

  it("skips empty and unknown entries", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "unknown, 4.4.4.4, " }))).toBe("4.4.4.4");
  });
});

describe("headersFromReq", () => {
  it("passes web Headers through untouched", () => {
    const h = headers({ "x-forwarded-for": "1.1.1.1" });
    expect(headersFromReq({ headers: h }).get("x-forwarded-for")).toBe("1.1.1.1");
  });

  it("converts Node-style header maps", () => {
    const out = headersFromReq({ headers: { "x-forwarded-for": "2.2.2.2, 3.3.3.3" } });
    expect(getClientIp(out)).toBe("3.3.3.3");
  });

  it("never throws on garbage input", () => {
    expect(getClientIp(headersFromReq(undefined))).toBe("unknown");
    expect(getClientIp(headersFromReq(null))).toBe("unknown");
  });
});

describe("fixed-window limiter", () => {
  it("allows up to max, then blocks with a retry hint", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 }, "t-fixed");
    const now = 1_000_000;
    expect((await limiter.check("k", now)).allowed).toBe(true);
    expect((await limiter.check("k", now)).allowed).toBe(true);
    expect((await limiter.check("k", now)).allowed).toBe(true);
    const blocked = await limiter.check("k", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window passes", async () => {
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 }, "t-window");
    expect((await limiter.check("k", 0)).allowed).toBe(true);
    expect((await limiter.check("k", 500)).allowed).toBe(false);
    expect((await limiter.check("k", 1500)).allowed).toBe(true);
  });

  it("tracks keys independently", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 }, "t-indep");
    expect((await limiter.check("a", 0)).allowed).toBe(true);
    expect((await limiter.check("b", 0)).allowed).toBe(true);
    expect((await limiter.check("a", 0)).allowed).toBe(false);
  });

  it("reset() clears accumulated failures", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 }, "t-reset");
    expect((await limiter.check("k", 0)).allowed).toBe(true);
    expect((await limiter.check("k", 0)).allowed).toBe(false);
    await limiter.reset("k");
    expect((await limiter.check("k", 0)).allowed).toBe(true);
  });
});

describe("preset budgets (auth + chat abuse ceilings)", () => {
  it("login accounts trip after repeated failures", async () => {
    const now = 0;
    let blocked = false;
    for (let i = 0; i < 20; i++) {
      if (!(await loginAccountLimiter.check(`test-login-${i % 2 === 0 ? "a" : "b"}`, now)).allowed) blocked = true;
    }
    // 10 attempts per account per 15 min: 20 spread over 2 accounts stays allowed…
    expect(blocked).toBe(false);
    for (let i = 0; i < 11; i++) await loginAccountLimiter.check("test-login-single", now);
    expect((await loginAccountLimiter.check("test-login-single", now)).allowed).toBe(false);
  });

  it("forgot-email budget is tight per address", async () => {
    const now = 0;
    for (let i = 0; i < 5; i++) expect((await forgotEmailLimiter.check("test-forgot@example.com", now)).allowed).toBe(true);
    expect((await forgotEmailLimiter.check("test-forgot@example.com", now)).allowed).toBe(false);
  });

  it("new-conversation farming is capped per IP per day", async () => {
    const now = 0;
    for (let i = 0; i < 15; i++) expect((await chatNewConversationLimiter.check("test-farmer", now)).allowed).toBe(true);
    expect((await chatNewConversationLimiter.check("test-farmer", now)).allowed).toBe(false);
  });

  it("conversation turns are capped per thread per day", async () => {
    const now = 0;
    for (let i = 0; i < 60; i++) expect((await chatConversationTurnLimiter.check("test-thread", now)).allowed).toBe(true);
    expect((await chatConversationTurnLimiter.check("test-thread", now)).allowed).toBe(false);
  });
});

describe("rateLimitedResponse reveals nothing", () => {
  it("returns a generic 429 with no internals", async () => {
    const res = rateLimitedResponse(61_000);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("61");
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/account|email|exists|organization|limit|bucket|redis/i);
  });
});
