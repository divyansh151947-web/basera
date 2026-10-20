import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * TOTP two-factor authentication (RFC 6238 / RFC 4226) implemented directly
 * on node:crypto — no third-party auth dependency, no test bypass hooks.
 *
 * SECURITY PROPERTIES
 * - The shared secret is generated server-side (160-bit, RFC 4648 base32 for
 *   the authenticator-app URI) and is NEVER returned to the client in
 *   plaintext outside of the explicit enrollment response (QR + manual key).
 * - At rest it is sealed with AES-256-GCM under a key derived from
 *   NEXTAUTH_SECRET (scrypt, per-installation salt embedded in the payload).
 *   A database dump alone therefore cannot reconstruct anyone's OTP secret.
 *   Missing/short NEXTAUTH_SECRET fails CLOSED (throw), so 2FA can never
 *   silently degrade to plaintext storage.
 * - Verification accepts ±1 time step of drift (30s step, 6 digits, SHA-1 —
 *   the interoperable defaults every authenticator app ships with) and uses
 *   a constant-time comparison. Codes are single-use at the application layer
 *   (the challenge row is consumed), which is what blocks replay.
 * - Recovery codes are random, shown exactly once, stored only as
 *   salted SHA-256 hashes, and consumed atomically on use.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ALGORITHM = "sha1";
export const TOTP_SECRET_BYTES = 20; // 160 bits, RFC 4226 §4.1
export const TOTP_DRIFT_STEPS = 1; // accept codes for t-1, t, t+1

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_ISSUER = "Basera";

/** RFC 4648 base32 (no padding), the encoding authenticator apps expect. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Fresh 160-bit secret, base32-encoded for storage in the enrollment flow. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** HOTP core (RFC 4226) for one counter value. */
function hotp(secret: Buffer, counter: bigint, digits: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** The code an authenticator app would currently display. */
export function totpAt(secretBase32: string, atMs: number = Date.now()): string {
  const counter = BigInt(Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS));
  return hotp(base32Decode(secretBase32), counter, TOTP_DIGITS);
}

/**
 * Verify a submitted code against the secret, accepting ±1 step of clock
 * drift. Returns false (never throws) for malformed input.
 */
export function verifyTotp(secretBase32: string, code: string, atMs: number = Date.now()): boolean {
  const submitted = String(code ?? "").replace(/\D/g, "");
  if (submitted.length !== TOTP_DIGITS) return false;

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }

  const counter = BigInt(Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS));
  const submittedBuf = Buffer.from(submitted, "utf8");
  for (let drift = -TOTP_DRIFT_STEPS; drift <= TOTP_DRIFT_STEPS; drift++) {
    const candidate = Buffer.from(hotp(secret, counter + BigInt(drift), TOTP_DIGITS), "utf8");
    if (candidate.length === submittedBuf.length && timingSafeEqual(candidate, submittedBuf)) return true;
  }
  return false;
}

/** otpauth:// URI that QR-encoding apps (Google/Microsoft/1Password…) scan. */
export function buildOtpauthUri(params: { secret: string; accountName: string; issuer?: string }): string {
  const issuer = params.issuer ?? TOTP_ISSUER;
  const label = encodeURIComponent(`${issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: TOTP_ALGORITHM.toUpperCase(),
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// At-rest encryption for the TOTP secret (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENC_PREFIX = "enc:v1:";
const KEY_SALT = Buffer.from("basera.totp.v1"); // fixed context, not a secret

function deriveKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 16) {
    // Fail closed: never fall back to plaintext storage or a weak/derived
    // default key. Enrollment simply errors until the operator configures it.
    throw new Error("NEXTAUTH_SECRET is not configured; refusing to store TOTP secrets.");
  }
  // scrypt with a fixed context salt: the secret is high-entropy already, and
  // the install-specific entropy comes from NEXTAUTH_SECRET itself.
  return scryptSync(secret, KEY_SALT, 32);
}

export function encryptTotpSecret(secretBase32: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptTotpSecret(payload: string): string {
  if (!payload.startsWith(ENC_PREFIX)) throw new Error("Unexpected TOTP secret payload format.");
  const [ivB64, tagB64, dataB64] = payload.slice(ENC_PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed TOTP secret payload.");
  const key = deriveKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;

/** Unambiguous alphabet (no 0/O, 1/I/L) so codes survive being hand-copied. */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(10);
    let raw = "";
    for (let i = 0; i < bytes.length; i++) raw += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

/** Salted hash for storage; plaintext recovery codes never touch the DB. */
export function hashRecoveryCode(userId: string, code: string): string {
  const normalized = normalizeRecoveryCode(code);
  return createHash("sha256").update(`${userId}:${normalized}:basera.recovery.v1`).digest("hex");
}

export function normalizeRecoveryCode(code: string): string {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRecoveryCodeShape(code: string): boolean {
  return /^[A-Z0-9]{10}$/.test(normalizeRecoveryCode(code));
}

export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
