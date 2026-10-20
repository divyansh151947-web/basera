import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { shouldRevokeSession } from "./auth";
import { VERIFY_TOKEN_PREFIX, buildVerifyToken, isVerifyTokenFormat } from "./email-verification";
import bcrypt from "bcryptjs";

describe("M-1: session revocation decision", () => {
  const live = { passwordHash: "hash-v2", isActive: true };

  it("keeps a session whose password binding matches", () => {
    expect(shouldRevokeSession("hash-v2", live)).toBe(false);
  });

  it("revokes when the password changed since sign-in", () => {
    expect(shouldRevokeSession("hash-v1", live)).toBe(true);
  });

  it("revokes sessions minted before password binding existed", () => {
    expect(shouldRevokeSession(null, live)).toBe(true);
    expect(shouldRevokeSession(undefined, live)).toBe(true);
    expect(shouldRevokeSession("", live)).toBe(true);
  });

  it("revokes when the account is gone or deactivated", () => {
    expect(shouldRevokeSession("hash-v2", null)).toBe(true);
    expect(shouldRevokeSession("hash-v2", { passwordHash: "hash-v2", isActive: false })).toBe(true);
  });
});

describe("M-2: verification token format and storage", () => {
  it("accepts only properly namespaced tokens", () => {
    expect(isVerifyTokenFormat("verify_abcdef12345678901")).toBe(true);
    expect(isVerifyTokenFormat("abcdef1234567890")).toBe(false);
    expect(isVerifyTokenFormat("verify_short")).toBe(false);
    expect(isVerifyTokenFormat("")).toBe(false);
    expect(isVerifyTokenFormat(null)).toBe(false);
    expect(isVerifyTokenFormat(123)).toBe(false);
  });

  it("mints prefixed tokens whose bcrypt hash verifies (nothing stored here)", async () => {
    const { rawToken, tokenHash } = await buildVerifyToken();
    expect(isVerifyTokenFormat(rawToken)).toBe(true);
    expect(tokenHash).not.toContain(rawToken);
    expect(await bcrypt.compare(rawToken, tokenHash)).toBe(true);
  });

  it("reset-style bare-hex tokens never collide with the verify namespace", async () => {
    const { rawToken } = await buildVerifyToken();
    expect(rawToken.startsWith(VERIFY_TOKEN_PREFIX)).toBe(true);
    // Reset tokens are bare hex and cannot carry the prefix by construction.
    expect(/^[0-9a-f]+$/.test(rawToken.slice(VERIFY_TOKEN_PREFIX.length))).toBe(true);
  });
});
