import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertEmailUrlSafe,
  classifyResendError,
  getAppUrl,
  getEmailDiagnostics,
  getPasswordResetDeliveryStatus,
  getResendFromAddress,
  getResetPasswordUrl,
  getVerifyEmailUrl,
  isEmailTimeout,
  isPublicAppUrl,
  isValidSenderAddress,
  sendPasswordResetEmail,
  sendVerificationEmail,
  withEmailTimeout,
} from "./email";
import { shouldBlockUnverifiedLogin } from "./auth";

const SAVED = {
  appUrl: process.env.APP_URL,
  nextUrl: process.env.NEXTAUTH_URL,
  emailFrom: process.env.EMAIL_FROM,
  resendFrom: process.env.RESEND_FROM,
};

afterEach(() => {
  vi.unstubAllEnvs();
  if (SAVED.appUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = SAVED.appUrl;
  if (SAVED.nextUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = SAVED.nextUrl;
  if (SAVED.emailFrom === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = SAVED.emailFrom;
  if (SAVED.resendFrom === undefined) delete process.env.RESEND_FROM;
  else process.env.RESEND_FROM = SAVED.resendFrom;
});

describe("APP_URL link generation", () => {
  it("uses APP_URL with trailing-slash tolerance and encodes tokens", () => {
    process.env.APP_URL = "https://www.basera.com/";
    delete process.env.NEXTAUTH_URL;
    expect(getAppUrl()).toBe("https://www.basera.com");
    expect(getVerifyEmailUrl("verify_abc+123")).toBe("https://www.basera.com/verify-email?token=verify_abc%2B123");
    expect(getResetPasswordUrl("tok")).toBe("https://www.basera.com/reset-password?token=tok");
  });

  it("falls back to NEXTAUTH_URL, then local dev default", () => {
    delete process.env.APP_URL;
    process.env.NEXTAUTH_URL = "https://staging.example.com";
    expect(getAppUrl()).toBe("https://staging.example.com");
    delete process.env.NEXTAUTH_URL;
    expect(getAppUrl()).toBe("http://localhost:4100");
  });

  it("no production link ever contains localhost", () => {
    process.env.APP_URL = "https://www.basera.com";
    expect(getVerifyEmailUrl("verify_x")).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(getResetPasswordUrl("x")).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});

describe("public origin guard", () => {
  it("accepts public HTTPS origins only", () => {
    expect(isPublicAppUrl("https://www.basera.com")).toBe(true);
    expect(isPublicAppUrl("https://basera.com/path")).toBe(true);
    expect(isPublicAppUrl("http://www.basera.com")).toBe(false);
    expect(isPublicAppUrl("http://localhost:4100")).toBe(false);
    expect(isPublicAppUrl("https://localhost:4100")).toBe(false);
    expect(isPublicAppUrl("https://127.0.0.1:4100")).toBe(false);
    expect(isPublicAppUrl("https://192.168.1.10")).toBe(false);
    expect(isPublicAppUrl("not-a-url")).toBe(false);
  });

  it("refuses unsafe origins in production but allows local dev", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.APP_URL = "http://localhost:4100";
    expect(assertEmailUrlSafe()).toBe(false);
    process.env.APP_URL = "https://www.basera.com";
    expect(assertEmailUrlSafe()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    process.env.APP_URL = "http://localhost:4100";
    expect(assertEmailUrlSafe()).toBe(true);
  });
});

describe("sender configuration", () => {
  it("prefers EMAIL_FROM, keeps RESEND_FROM as alias, then default", () => {
    process.env.EMAIL_FROM = "Basera <no-reply@basera.com>";
    process.env.RESEND_FROM = "Other <other@example.com>";
    expect(getResendFromAddress()).toBe("Basera <no-reply@basera.com>");
    delete process.env.EMAIL_FROM;
    expect(getResendFromAddress()).toBe("Other <other@example.com>");
    delete process.env.RESEND_FROM;
    expect(getResendFromAddress()).toBe("Basera <onboarding@resend.dev>");
  });
});

describe("unverified-login gate", () => {
  it("blocks real unverified accounts only", () => {
    expect(shouldBlockUnverifiedLogin(null, { isDemo: false })).toBe(true);
    expect(shouldBlockUnverifiedLogin(undefined, { isDemo: false })).toBe(true);
    expect(shouldBlockUnverifiedLogin("2026-01-01T00:00:00.000Z", { isDemo: false })).toBe(false);
    expect(shouldBlockUnverifiedLogin(null, { isDemo: true })).toBe(false);
    expect(shouldBlockUnverifiedLogin(null, null)).toBe(false);
  });
});

describe("verification email payload (provider-agnostic content)", () => {
  const SAVED_KEY = process.env.RESEND_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (SAVED_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = SAVED_KEY;
  });

  it("sends to any recipient address with the required content and APP_URL link", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.APP_URL = "https://www.basera.com";
    vi.stubEnv("NODE_ENV", "development");
    const requests: Array<{ url: string; body: any }> = [];
    const resendResponse = () => ({
      ok: true,
      status: 200,
      headers: { entries: () => [] as Array<[string, string]> },
      text: async () => "",
      json: async () => ({ id: "mail_123" }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return resendResponse();
      })
    );
    // Same payload shape for Gmail, iCloud, Outlook, Yahoo, or work mail —
    // delivery follows the entered address, never the device or provider.
    for (const to of ["someone@gmail.com", "someone@icloud.com", "someone@outlook.com", "user@company.com"]) {
      const result = await sendVerificationEmail({ to, name: "Test User", token: "verify_abc123" });
      expect(result.ok).toBe(true);
    }
    expect(requests).toHaveLength(4);
    for (const { body } of requests) {
      expect(body.subject).toBe("Verify your Basera email address");
      expect(body.html).toContain("Basera Email Verification");
      expect(body.html).toContain("You created a Basera workspace using this email address.");
      expect(body.html).toContain("Verify My Email");
      expect(body.html).toContain("https://www.basera.com/verify-email?token=verify_abc123");
      expect(body.html).toContain("valid for 24 hours and can only be used once");
      expect(body.html).toContain("safely ignore this email");
      expect(body.text).toContain("Basera Email Verification");
    }
    const recipients = requests.map((r) => r.body.to[0]);
    expect(recipients).toEqual(["someone@gmail.com", "someone@icloud.com", "someone@outlook.com", "user@company.com"]);
  });

  it("local links use the local APP_URL, never production", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.APP_URL;
    delete process.env.NEXTAUTH_URL;
    vi.stubEnv("NODE_ENV", "development");
    let captured = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        captured = JSON.parse(init.body).html as string;
        return {
          ok: true,
          status: 200,
          headers: { entries: () => [] as Array<[string, string]> },
          text: async () => "",
          json: async () => ({ id: "mail_1" }),
        };
      })
    );
    await sendVerificationEmail({ to: "dev@example.com", token: "verify_x" });
    expect(captured).toContain("http://localhost:4100/verify-email?token=verify_x");
    expect(captured).not.toContain("basera.com");
  });
});

describe("password reset email content and diagnostics", () => {
  const resendOk = () => ({
    ok: true,
    status: 200,
    headers: { entries: () => [] as Array<[string, string]> },
    text: async () => "",
    json: async () => ({ id: "mail_reset_1" }),
  });

  it("reset payload identifies Basera with APP_URL link in HTML and text", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.APP_URL = "https://www.basera.com";
    vi.stubEnv("NODE_ENV", "development");
    let captured: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        captured = JSON.parse(init.body);
        return resendOk();
      })
    );
    const result = await sendPasswordResetEmail({ to: "user@example.com", name: "User", token: "abc123token" });
    expect(result.ok).toBe(true);
    expect(result.id).toBe("mail_reset_1");
    expect(captured.subject).toBe("Reset your Basera password");
    expect(captured.html).toContain("Basera Password Reset");
    expect(captured.html).toContain("reset the password for your Basera account");
    expect(captured.html).toContain("Reset My Password");
    expect(captured.html).toContain("https://www.basera.com/reset-password?token=abc123token");
    expect(captured.html).toContain("valid for 1 hour and can only be used once");
    expect(captured.html).toContain("safely ignore this email");
    expect(captured.text).toContain("Basera Password Reset");
    expect(captured.text).toContain("https://www.basera.com/reset-password?token=abc123token");
    expect(captured.to).toEqual(["user@example.com"]);
  });

  it("missing-key path never logs tokens or reset URLs", async () => {
    delete process.env.RESEND_API_KEY;
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void logged.push(args));
    try {
      const result = await sendPasswordResetEmail({ to: "user@example.com", token: "supersecrettoken123" });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(logged)).not.toMatch(/supersecrettoken123|reset-password\?token=/);
    } finally {
      spy.mockRestore();
    }
  });

  it("diagnostics expose status without secrets, tokens, or recipients", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.APP_URL = "https://www.basera.com";
    process.env.EMAIL_FROM = "Basera <no-reply@basera.com>";
    const d = getEmailDiagnostics();
    expect(d).toEqual({
      emailProvider: "resend",
      apiKeyConfigured: true,
      smtpConfigured: false,
      sender: "Basera <no-reply@basera.com>",
      senderDomain: "basera.com",
      appOrigin: "https://www.basera.com",
      appOriginPublic: true,
    });
    expect(JSON.stringify(d)).not.toMatch(/re_test_key|token|@example|user/i);
    delete process.env.RESEND_API_KEY;
    expect(getEmailDiagnostics().apiKeyConfigured).toBe(false);
  });
});

describe("reset error classification and delivery diagnostics", () => {
  const resendOk = (id = "mail_x") => ({
    ok: true,
    status: 200,
    headers: { entries: () => [] as Array<[string, string]> },
    text: async () => "",
    json: async () => ({ id }),
  });

  it("classifies provider failures without leaking internals", () => {
    expect(classifyResendError({ statusCode: 401, message: "Invalid API key" })).toBe("invalid_api_key");
    expect(classifyResendError({ statusCode: 429, message: "Too many" })).toBe("rate_limited");
    expect(classifyResendError({ statusCode: 403, message: "Domain not verified" })).toBe("unverified_sender");
    expect(classifyResendError({ statusCode: 422, message: "Validation failed" })).toBe("unverified_sender");
    expect(classifyResendError({ statusCode: 500, message: "Oops" })).toBe("rejected");
    expect(classifyResendError({})).toBe("rejected");
  });

  it("validates sender addresses before network use", () => {
    expect(isValidSenderAddress("Basera <no-reply@basera.com>")).toBe(true);
    expect(isValidSenderAddress("no-reply@basera.com")).toBe(true);
    expect(isValidSenderAddress("not-an-address")).toBe(false);
    expect(isValidSenderAddress("Basera <missing-bracket")).toBe(false);
    expect(isValidSenderAddress("")).toBe(false);
  });

  it("rejects malformed senders without calling Resend", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "not-an-address";
    vi.stubEnv("NODE_ENV", "development");
    const spy = vi.fn(async () => {
      throw new Error("must not be called");
    });
    vi.stubGlobal("fetch", spy);
    const result = await sendPasswordResetEmail({ to: "u@example.com", token: "tok" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_sender");
    expect(spy).not.toHaveBeenCalled();
    delete process.env.EMAIL_FROM;
  });

  it("maps provider rejections to granular reasons", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.EMAIL_FROM;
    vi.stubEnv("NODE_ENV", "development");
    // The SDK surfaces provider rejections via non-2xx responses; emulate
    // that shape (ok:false + error JSON in the body).
    const failWith = (status: number, error: any) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          status,
          headers: { entries: () => [] as Array<[string, string]> },
          text: async () => JSON.stringify(error),
          json: async () => error,
        }))
      );
    };
    failWith(401, { statusCode: 401, message: "Invalid API key", name: "validation_error" });
    expect((await sendPasswordResetEmail({ to: "u@example.com", token: "t" })).reason).toBe("invalid_api_key");
    failWith(403, { statusCode: 403, message: "Domain not verified", name: "validation_error" });
    expect((await sendPasswordResetEmail({ to: "u@example.com", token: "t" })).reason).toBe("unverified_sender");
  });

  it("times out hung provider calls instead of hanging", async () => {
    const hanging = new Promise(() => {});
    await expect(withEmailTimeout(hanging, 20)).rejects.toSatisfy(isEmailTimeout);
  });

  it("resolves delivery states from Resend email lookup", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const lookup = (lastEvent: string | null) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          headers: { entries: () => [] as Array<[string, string]> },
          text: async () => "",
          json: async () => (lastEvent ? { id: "m1", last_event: lastEvent } : { id: "m1" }),
        }))
      );
    };
    lookup("delivered");
    expect(await getPasswordResetDeliveryStatus("m1")).toEqual({ state: "delivered", emailId: "m1" });
    lookup("opened");
    expect(await getPasswordResetDeliveryStatus("m1")).toEqual({ state: "delivered", emailId: "m1" });
    lookup("bounced");
    expect(await getPasswordResetDeliveryStatus("m1")).toEqual({ state: "bounced", emailId: "m1" });
    lookup("delivery_delayed");
    expect(await getPasswordResetDeliveryStatus("m1")).toEqual({ state: "delivery_delayed", emailId: "m1" });
    lookup(null);
    expect(await getPasswordResetDeliveryStatus("m1")).toEqual({ state: "accepted", emailId: "m1" });
    delete process.env.RESEND_API_KEY;
    expect(await getPasswordResetDeliveryStatus("m1")).toEqual({ state: "unknown", emailId: "m1" });
  });
});
