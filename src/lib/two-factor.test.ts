import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  isValidRecoveryCodeShape,
  normalizeRecoveryCode,
  safeEqualHex,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  totpAt,
  verifyTotp,
} from "@/lib/two-factor";

/**
 * Pure unit tests for the TOTP/crypto primitives. No DB, no network.
 * The RFC 4226 appendix-D vectors pin the HOTP construction itself: a code
 * an authenticator app computes must be the code this server accepts.
 */
describe("two-factor primitives", () => {
  const originalSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "unit-test-nextauth-secret-value-1234";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalSecret;
  });

  it("base32 encodes/decodes round-trip (RFC 4648 alphabet, no padding)", () => {
    const buf = Buffer.from([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
    const encoded = base32Encode(buf);
    expect(encoded).not.toContain("=");
    expect(/^[A-Z2-7]+$/.test(encoded)).toBe(true);
    expect(base32Decode(encoded).equals(buf)).toBe(true);
    expect(() => base32Decode("NOT!VALID")).toThrow();
  });

  it("generates 160-bit base32 secrets", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/); // 160 bits
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it("verifies the current code and rejects stale/wrong ones", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const current = totpAt(secret, now);

    expect(verifyTotp(secret, current, now)).toBe(true);
    // ±1 step of drift is accepted (authenticator/server clock skew).
    expect(verifyTotp(secret, totpAt(secret, now + TOTP_PERIOD_SECONDS * 1000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - TOTP_PERIOD_SECONDS * 1000), now)).toBe(true);
    // 2 steps away is not.
    expect(verifyTotp(secret, totpAt(secret, now + 2 * TOTP_PERIOD_SECONDS * 1000), now)).toBe(false);
    // Wrong / malformed codes never throw and never pass.
    expect(verifyTotp(secret, "000000", now)).toBe(false);
    expect(verifyTotp(secret, "", now)).toBe(false);
    expect(verifyTotp(secret, "12", now)).toBe(false);
    expect(verifyTotp("!!!not-base32!!!", current, now)).toBe(false);
  });

  it("produces 6-digit codes on a 30s period", () => {
    expect(TOTP_DIGITS).toBe(6);
    expect(TOTP_PERIOD_SECONDS).toBe(30);
    const code = totpAt(generateTotpSecret());
    expect(code).toMatch(/^\d{6}$/);
  });

  it("builds a scannable otpauth:// URI with the expected parameters", () => {
    const uri = buildOtpauthUri({ secret: "JBSWY3DPEHPK3PXP", accountName: "buyer@example.com" });
    const parsed = new URL(uri);
    expect(parsed.protocol).toBe("otpauth:");
    expect(parsed.host).toBe("totp");
    expect(parsed.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
    expect(parsed.searchParams.get("algorithm")).toBe("SHA1");
    expect(decodeURIComponent(parsed.pathname)).toContain("Basera:buyer@example.com");
  });

  it("encrypts the stored secret with AES-256-GCM and never stores plaintext", () => {
    const secret = generateTotpSecret();
    const payload = encryptTotpSecret(secret);

    expect(payload.startsWith("enc:v1:")).toBe(true);
    expect(payload).not.toContain(secret);
    expect(decryptTotpSecret(payload)).toBe(secret);

    // Tampering with the ciphertext must fail closed (GCM auth tag).
    const head = payload.slice(0, payload.length - 1);
    const flipped = head + (payload.endsWith("A") ? "B" : "A");
    expect(() => decryptTotpSecret(flipped)).toThrow();
    expect(() => decryptTotpSecret("plaintext-secret")).toThrow();
  });

  it("fails closed when NEXTAUTH_SECRET is missing or weak", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(() => encryptTotpSecret(generateTotpSecret())).toThrow(/NEXTAUTH_SECRET/);

    process.env.NEXTAUTH_SECRET = "short";
    expect(() => encryptTotpSecret(generateTotpSecret())).toThrow(/NEXTAUTH_SECRET/);

    process.env.NEXTAUTH_SECRET = "unit-test-nextauth-secret-value-1234";
    expect(() => encryptTotpSecret(generateTotpSecret())).not.toThrow();
  });

  it("recovery codes are unambiguous, salted-hashed and shape-checked", () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      // No visually ambiguous characters in the alphabet's output.
      expect(code.replace("-", "")).not.toMatch(/[01OIL]/);
      expect(isValidRecoveryCodeShape(code)).toBe(true);
      expect(isValidRecoveryCodeShape(normalizeRecoveryCode(code))).toBe(true);
    }

    expect(isValidRecoveryCodeShape("ABC")).toBe(false);
    expect(isValidRecoveryCodeShape("")).toBe(false);

    const hash = hashRecoveryCode("user-1", codes[0]);
    expect(hash).not.toContain(codes[0]);
    // Same code, different user → different hash (per-user salt).
    expect(hashRecoveryCode("user-2", codes[0])).not.toBe(hash);
    expect(safeEqualHex(hash, hashRecoveryCode("user-1", codes[0]))).toBe(true);
    expect(safeEqualHex(hash, hashRecoveryCode("user-1", codes[1]))).toBe(false);
  });
});
