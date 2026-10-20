import "server-only";

import { Resend } from "resend";
import nodemailer from "nodemailer";

// Production email setup notes:
// 1. Add a verified domain in Resend.
// 2. Configure the DNS records that Resend provides.
// 3. Verify the custom domain.
// 4. Set RESEND_API_KEY and RESEND_FROM in the environment.
// 5. Set APP_URL or NEXTAUTH_URL to the live origin for password-reset links.
// Without these values, the app logs the failure and keeps the public
// forgot-password response generic instead of pretending delivery succeeded.

export function getAppUrl() {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:4100").replace(/\/$/, "");
}

/**
 * True only for publicly reachable HTTPS origins (excludes localhost,
 * loopback, and private-network hosts). Used to guarantee production
 * emails never carry localhost links — a misconfigured APP_URL fails
 * loudly instead of sending unreachable links to real inboxes.
 */
export function isPublicAppUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?(::1|fe80|fc00|fd))/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Production safety: refuse to compose email links from a non-public
 *  origin when running in production. Local dev is unaffected. */
export function assertEmailUrlSafe() {
  if (process.env.NODE_ENV === "production" && !isPublicAppUrl(getAppUrl())) {
    return false;
  }
  return true;
}

export function getResetPasswordUrl(token: string) {
  return `${getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

export function getVerifyEmailUrl(token: string) {
  return `${getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

export function getResendFromAddress() {
  // EMAIL_FROM is the canonical sender; RESEND_FROM is kept as a legacy alias.
  return process.env.EMAIL_FROM?.trim() || process.env.RESEND_FROM?.trim() || "Basera <onboarding@resend.dev>";
}

export function hasEmailProviderConfig() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * Gmail/App-password SMTP configuration for local development and testing.
 * SMTP_PASSWORD must be a Google App Password, never the account password.
 * Only the presence of these values is ever inspected — the secret itself
 * is passed straight to Nodemailer and never logged or returned.
 */
export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD ?? "";
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT?.trim() || "465");
  const safePort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 465;
  const from = process.env.SMTP_FROM?.trim() || user;
  return { host, port: safePort, secure: safePort === 465, user, pass, from };
}

export function hasSmtpConfig() {
  return getSmtpConfig() !== null;
}

export type ActiveEmailProvider = "smtp" | "resend" | "none";

/** Provider selection: SMTP wins when fully configured, else Resend, else none. */
export function getActiveEmailProvider(): ActiveEmailProvider {
  if (hasSmtpConfig()) return "smtp";
  if (hasEmailProviderConfig()) return "resend";
  return "none";
}

/** Extract the sender domain for safe diagnostic metadata (no PII). */
export function getSenderDomain(from?: string) {
  const value = from ?? getResendFromAddress();
  const match = value.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  return match ? match[1].toLowerCase() : "unknown";
}

/**
 * Safe runtime diagnostics for the email subsystem. Contains NO secrets,
 * tokens, URLs, or recipient addresses — safe to log and to assert in
 * tests. Use it instead of ad-hoc log fields when diagnosing delivery.
 */
export function getEmailDiagnostics() {
  const appOrigin = getAppUrl();
  const active = getActiveEmailProvider();
  const sender = active === "smtp" ? (getSmtpConfig()?.from ?? getResendFromAddress()) : getResendFromAddress();
  return {
    emailProvider: active,
    apiKeyConfigured: hasEmailProviderConfig(),
    smtpConfigured: hasSmtpConfig(),
    sender,
    senderDomain: getSenderDomain(sender),
    appOrigin,
    appOriginPublic: isPublicAppUrl(appOrigin),
  };
}

export interface DeliverEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface DeliverEmailResult {
  ok: boolean;
  reason: string;
  provider: "smtp" | "resend";
  id?: string | null;
  error?: unknown;
}

function isSmtpAuthError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  const responseCode = (error as { responseCode?: unknown })?.responseCode;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    code === "EAUTH" ||
    responseCode === 535 ||
    responseCode === 534 ||
    /auth|credential|password|username|535|534|5\.7\.8/i.test(message)
  );
}

async function sendViaSmtp(input: DeliverEmailInput, config: SmtpConfig): Promise<DeliverEmailResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const info = await transporter.sendMail({
      from: config.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { ok: true, reason: "sent", provider: "smtp", id: info?.messageId ?? null };
  } catch (error) {
    return {
      ok: false,
      reason: isSmtpAuthError(error) ? "invalid_smtp_credentials" : "provider_error",
      provider: "smtp",
      error,
    };
  }
}

async function sendViaResend(input: DeliverEmailInput): Promise<DeliverEmailResult> {
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const response = await withEmailTimeout(
    resend.emails.send({
      from: getResendFromAddress(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
  );
  if (response.error) {
    return { ok: false, reason: classifyResendError(response.error), provider: "resend", error: response.error };
  }
  return { ok: true, reason: "sent", provider: "resend", id: response.data?.id ?? null };
}

/**
 * Single delivery entry point used by every transactional sender.
 * SMTP (fully configured) wins for local/dev; otherwise the existing
 * Resend path runs unchanged. The recipient always comes from the caller
 * (the account/request email) — SMTP_USER is sender/auth only and is never
 * substituted as a recipient here or anywhere else.
 */
export async function deliverEmail(input: DeliverEmailInput): Promise<DeliverEmailResult> {
  const smtp = getSmtpConfig();
  if (smtp) return sendViaSmtp(input, smtp);
  return sendViaResend(input);
}

export async function sendPasswordResetEmail({
  to,
  name,
  token,
}: {
  to: string;
  name?: string | null;
  token: string;
}) {
  if (getActiveEmailProvider() === "none") {
    // No token/URL here: reset links must never reach logs either.
    console.warn("[email] Password reset requested but no email provider is configured. Email delivery deferred.", {
      ...getEmailDiagnostics(),
      reason: "missing_api_key",
    });
    return { ok: false, reason: "missing_api_key", provider: "resend" as const };
  }

  if (!assertEmailUrlSafe()) {
    // Production must never email localhost links to real inboxes.
    console.error("[email] Refusing to send: APP_URL is not a public HTTPS origin in production.", {
      reason: "unsafe_app_url",
    });
    return { ok: false, reason: "unsafe_app_url", provider: "resend" as const };
  }

  // Validate the active sender before touching the network: a malformed
  // From address can never be accepted, so fail fast with a clear reason.
  const from = getActiveEmailProvider() === "smtp" ? (getSmtpConfig()?.from ?? "") : getResendFromAddress();
  if (!isValidSenderAddress(from)) {
    console.error("[email] Refusing to send: sender address is malformed.", {
      ...getEmailDiagnostics(),
      reason: "invalid_sender",
    });
    return { ok: false, reason: "invalid_sender", provider: "resend" as const };
  }

  const resetUrl = getResetPasswordUrl(token);
  const displayName = name?.trim() || "there";

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; background:#f5f7f8; padding:32px 16px; color:#102b3d;">
      <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e4edf0; border-radius:18px; overflow:hidden;">
        <div style="background:linear-gradient(135deg,#102b3d,#163b4d); padding:24px 28px;">
          <div style="font-size:26px; font-weight:700; color:#ffffff; letter-spacing:0.04em;">Basera</div>
        </div>
        <div style="padding:30px 28px 24px;">
          <h1 style="margin:0 0 14px; font-size:28px; color:#102b3d;">Basera Password Reset</h1>
          <p style="margin:0 0 18px; font-size:16px; line-height:1.6; color:#344a5b;">
            Hi ${displayName},<br /><br />
            We received a request to reset the password for your Basera account.
          </p>
          <div style="margin:26px 0; text-align:center;">
            <a href="${resetUrl}" style="display:inline-block; background:#102b3d; color:#ffffff; text-decoration:none; font-weight:600; border-radius:12px; padding:16px 24px;">Reset My Password</a>
          </div>
          <p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#51677b;">
            If the button doesn't work, copy and paste this link into your browser:<br />
            <a href="${resetUrl}" style="color:#163b4d; word-break:break-all;">${resetUrl}</a>
          </p>
          <p style="margin:0 0 8px; font-size:13px; line-height:1.6; color:#5b7182;">This link is valid for 1 hour and can only be used once.</p>
          <p style="margin:0; font-size:13px; line-height:1.6; color:#5b7182;">
            If you did not request a password reset, you can safely ignore this email.
          </p>
        </div>
      </div>
    </div>
  `;

  const text = `Basera Password Reset\n\nHi ${displayName},\n\nWe received a request to reset the password for your Basera account.\n\nReset your password here: ${resetUrl}\n\nThis link is valid for 1 hour and can only be used once.\n\nIf you did not request a password reset, you can safely ignore this email.`;

  // The recipient always comes from the caller (the account/request email).
  // SMTP_USER is sender/authentication only and is never substituted here.
  const result = await deliverEmail({ to, subject: "Reset your Basera password", html, text });

  if (!result.ok) {
    console.error("[email] Password reset email failed", {
      ...getEmailDiagnostics(),
      reason: result.reason,
      error: result.error ?? null,
    });
    return { ok: false, reason: result.reason, provider: result.provider, error: result.error };
  }

  console.info("[email] Password reset email sent successfully", {
    ...getEmailDiagnostics(),
    emailId: result.id ?? null,
  });

  return { ok: true, reason: "sent", provider: result.provider, id: result.id ?? null };
}

/** Sender must be parseable as `Name <addr@domain>` or a bare address. */
export function isValidSenderAddress(from: string) {
  const match = from.match(/^(?:"?([^"]*)"?\s*)?<([^<>\s]+)>$/) ?? from.match(/^([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/);
  const address = match ? (match[2] ?? match[1] ?? "") : "";
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address);
}

export const EMAIL_SEND_TIMEOUT_MS = 15_000;

class EmailTimeoutError extends Error {
  constructor() {
    super("Email provider request timed out");
    this.name = "EmailTimeoutError";
  }
}

/** Race a provider call against a timeout so a hung upstream cannot tie up
 *  the serverless execution indefinitely. The provider may still process a
 *  timed-out send; callers treat timeout as indeterminate, never success. */
export function withEmailTimeout<T>(promise: Promise<T>, timeoutMs: number = EMAIL_SEND_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EmailTimeoutError()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function isEmailTimeout(error: unknown) {
  return error instanceof EmailTimeoutError;
}

export type ResendFailureReason =
  | "invalid_api_key"
  | "unverified_sender"
  | "rejected"
  | "rate_limited";

/**
 * Map a Resend error payload to a stable machine reason without leaking
 * anything sensitive. Shape follows the official SDK: { statusCode, message,
 * name }. 401 = bad/revoked key; 403 = forbidden (often unverified sender
 * or domain); 422 = validation rejection; 429 = provider throttling.
 */
export function classifyResendError(error: { statusCode?: unknown; message?: unknown; name?: unknown }): ResendFailureReason {
  const status = typeof error?.statusCode === "number" ? error.statusCode : null;
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  if (status === 401) return "invalid_api_key";
  if (status === 429) return "rate_limited";
  if (status === 403 || status === 422 || /verif|domain|sender|not allowed|forbidden/i.test(message)) {
    return "unverified_sender";
  }
  return "rejected";
}

export type ResendDeliveryState =
  | "accepted"
  | "delivered"
  | "delivery_delayed"
  | "bounced"
  | "failed"
  | "suppressed"
  | "unknown";

/**
 * Delivery observability: Resend accepts synchronously (email ID) and
 * delivers asynchronously. This resolves an email ID to its latest known
 * state via `emails.get` (last_event). Accepted ≠ delivered — callers must
 * keep that distinction. Returns "unknown" when the lookup itself fails.
 */
export async function getPasswordResetDeliveryStatus(emailId: string): Promise<{ state: ResendDeliveryState; emailId: string }> {
  if (!hasEmailProviderConfig() || !emailId) return { state: "unknown", emailId };
  try {
    const resend = new Resend(process.env.RESEND_API_KEY!);
    const { data, error } = await withEmailTimeout(resend.emails.get(emailId));
    if (error || !data) return { state: "unknown", emailId };
    const event = String((data as { last_event?: unknown }).last_event ?? "").toLowerCase();
    if (event.includes("delay")) return { state: "delivery_delayed", emailId };
    // "opened"/"clicked" imply successful delivery (the mailbox rendered it).
    if (event.includes("deliver") || event.includes("open") || event.includes("click")) {
      return { state: "delivered", emailId };
    }
    if (event.includes("bounc")) return { state: "bounced", emailId };
    if (event.includes("fail")) return { state: "failed", emailId };
    if (event.includes("suppress") || event.includes("complaint") || event.includes("unsubscrib")) {
      return { state: "suppressed", emailId };
    }
    return { state: "accepted", emailId };
  } catch {
    return { state: "unknown", emailId };
  }
}

export async function sendVerificationEmail({
  to,
  name,
  token,
}: {
  to: string;
  name?: string | null;
  token: string;
}) {
  if (getActiveEmailProvider() === "none") {
    // Deliberately NO token/URL here: verification tokens must never reach
    // logs. Callers treat ok:false as "deferred", not as failure.
    console.warn("[email] Verification requested but no email provider is configured. Email delivery deferred.", {
      ...getEmailDiagnostics(),
      reason: "missing_api_key",
    });
    return { ok: false, reason: "missing_api_key", provider: "resend" as const };
  }

  if (!assertEmailUrlSafe()) {
    console.error("[email] Refusing to send: APP_URL is not a public HTTPS origin in production.", {
      reason: "unsafe_app_url",
    });
    return { ok: false, reason: "unsafe_app_url", provider: "resend" as const };
  }

  const verifyUrl = getVerifyEmailUrl(token);
  const displayName = (name?.trim() || "there").replace(/[<>&"]/g, "");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; background:#f5f7f8; padding:32px 16px; color:#102b3d;">
      <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e4edf0; border-radius:18px; overflow:hidden;">
        <div style="background:linear-gradient(135deg,#102b3d,#163b4d); padding:24px 28px;">
          <div style="font-size:26px; font-weight:700; color:#ffffff; letter-spacing:0.04em;">Basera</div>
        </div>
        <div style="padding:30px 28px 24px;">
          <h1 style="margin:0 0 14px; font-size:28px; color:#102b3d;">Basera Email Verification</h1>
          <p style="margin:0 0 18px; font-size:16px; line-height:1.6; color:#344a5b;">
            Hi ${displayName},<br /><br />
            You created a Basera workspace using this email address.<br /><br />
            Please verify that you own this email address by clicking the button below.
          </p>
          <div style="margin:26px 0; text-align:center;">
            <a href="${verifyUrl}" style="display:inline-block; background:#102b3d; color:#ffffff; text-decoration:none; font-weight:600; border-radius:12px; padding:16px 24px;">Verify My Email</a>
          </div>
          <p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#51677b;">
            If the button doesn't work, copy and paste this link into your browser:<br />
            <a href="${verifyUrl}" style="color:#163b4d; word-break:break-all;">${verifyUrl}</a>
          </p>
          <p style="margin:0 0 8px; font-size:13px; line-height:1.6; color:#5b7182;">This verification link is valid for 24 hours and can only be used once.</p>
          <p style="margin:0; font-size:13px; line-height:1.6; color:#5b7182;">
            If you did not create a Basera account, you can safely ignore this email.
          </p>
        </div>
      </div>
    </div>
  `;

  const text = `Basera Email Verification\n\nHi ${displayName},\n\nYou created a Basera workspace using this email address.\n\nPlease verify that you own this email address by visiting this link: ${verifyUrl}\n\nThis verification link is valid for 24 hours and can only be used once.\n\nIf you did not create a Basera account, you can safely ignore this email.`;

  // The recipient always comes from the caller (the newly registered user
  // or the verification requester). SMTP_USER is sender/auth only.
  const result = await deliverEmail({ to, subject: "Verify your Basera email address", html, text });

  if (!result.ok) {
    console.error("[email] Verification email failed", {
      ...getEmailDiagnostics(),
      reason: result.reason,
      error: result.error ?? null,
    });
    return { ok: false, reason: result.reason, provider: result.provider, error: result.error };
  }

  console.info("[email] Verification email sent successfully", {
    ...getEmailDiagnostics(),
    emailId: result.id ?? null,
  });

  return { ok: true, reason: "sent", provider: result.provider, id: result.id ?? null };
}
