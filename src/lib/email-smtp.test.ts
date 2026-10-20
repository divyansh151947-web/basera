import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const sendMailMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
}));

import nodemailer from "nodemailer";
import {
  deliverEmail,
  getActiveEmailProvider,
  getSmtpConfig,
  hasSmtpConfig,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email";

const SAVED = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASSWORD,
  from: process.env.SMTP_FROM,
  key: process.env.RESEND_API_KEY,
};

function clearSmtpEnv() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_FROM;
}

function setSmtpEnv() {
  process.env.SMTP_HOST = "smtp.gmail.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USER = "sender.account@gmail.com";
  process.env.SMTP_PASSWORD = "app-password-xyz";
  process.env.SMTP_FROM = "Basera <sender.account@gmail.com>";
}

beforeEach(() => {
  clearSmtpEnv();
  delete process.env.RESEND_API_KEY;
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: "smtp-msg-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (SAVED.host === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = SAVED.host;
  if (SAVED.port === undefined) delete process.env.SMTP_PORT;
  else process.env.SMTP_PORT = SAVED.port;
  if (SAVED.user === undefined) delete process.env.SMTP_USER;
  else process.env.SMTP_USER = SAVED.user;
  if (SAVED.pass === undefined) delete process.env.SMTP_PASSWORD;
  else process.env.SMTP_PASSWORD = SAVED.pass;
  if (SAVED.from === undefined) delete process.env.SMTP_FROM;
  else process.env.SMTP_FROM = SAVED.from;
  if (SAVED.key === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = SAVED.key;
});

describe("SMTP configuration", () => {
  it("detects complete vs incomplete SMTP config", () => {
    expect(hasSmtpConfig()).toBe(false);
    expect(getSmtpConfig()).toBeNull();
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_USER = "a@gmail.com";
    expect(hasSmtpConfig()).toBe(false);
    process.env.SMTP_PASSWORD = "secret";
    const config = getSmtpConfig();
    expect(config).toMatchObject({ host: "smtp.gmail.com", port: 465, secure: true, user: "a@gmail.com" });
  });

  it("parses non-465 ports as non-secure with sender fallback", () => {
    setSmtpEnv();
    process.env.SMTP_PORT = "587";
    delete process.env.SMTP_FROM;
    const config = getSmtpConfig();
    expect(config?.secure).toBe(false);
    expect(config?.from).toBe("sender.account@gmail.com");
  });

  it("selects SMTP first, Resend fallback, none last", () => {
    expect(getActiveEmailProvider()).toBe("none");
    process.env.RESEND_API_KEY = "re_x";
    expect(getActiveEmailProvider()).toBe("resend");
    setSmtpEnv();
    expect(getActiveEmailProvider()).toBe("smtp");
  });
});

describe("SMTP delivery (mocked transport, no real sends)", () => {
  it("passes the dynamic recipient through, never SMTP_USER", async () => {
    setSmtpEnv();
    vi.stubEnv("NODE_ENV", "development");
    const result = await deliverEmail({ to: "pankaj@example.com", subject: "S", html: "<p>h</p>", text: "t" });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("smtp");
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.gmail.com", port: 465, secure: true })
    );
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe("pankaj@example.com");
    expect(call.to).not.toBe("sender.account@gmail.com");
    expect(JSON.stringify(call)).not.toContain("app-password-xyz");
  });

  it("signup verification goes to the new user's exact email", async () => {
    setSmtpEnv();
    vi.stubEnv("NODE_ENV", "development");
    const result = await sendVerificationEmail({ to: "urmiladevi169681@gmail.com", name: "U", token: "verify_abc" });
    expect(result.ok).toBe(true);
    expect(sendMailMock.mock.calls[0][0].to).toBe("urmiladevi169681@gmail.com");
    expect(sendMailMock.mock.calls[0][0].subject).toBe("Verify your Basera email address");
  });

  it("password reset goes to the requested account email with reset link", async () => {
    setSmtpEnv();
    vi.stubEnv("NODE_ENV", "development");
    process.env.APP_URL = "http://localhost:4100";
    const result = await sendPasswordResetEmail({ to: "rohit@example.com", token: "tok123" });
    expect(result.ok).toBe(true);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe("rohit@example.com");
    expect(call.subject).toBe("Reset your Basera password");
    expect(call.html).toContain("http://localhost:4100/reset-password?token=tok123");
    expect(call.text).toContain("http://localhost:4100/reset-password?token=tok123");
  });

  it("SMTP auth failures are reported, never claimed as sent", async () => {
    setSmtpEnv();
    vi.stubEnv("NODE_ENV", "development");
    const authError = Object.assign(new Error("Invalid login: 535"), { code: "EAUTH", responseCode: 535 });
    sendMailMock.mockRejectedValueOnce(authError);
    const result = await sendPasswordResetEmail({ to: "u@example.com", token: "t" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_smtp_credentials");
    expect(result.provider).toBe("smtp");
  });

  it("generic SMTP failures surface safely without credentials", async () => {
    setSmtpEnv();
    vi.stubEnv("NODE_ENV", "development");
    sendMailMock.mockRejectedValueOnce(new Error("socket hang up"));
    const result = await sendPasswordResetEmail({ to: "u@example.com", token: "t" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("provider_error");
    expect(JSON.stringify(result)).not.toContain("app-password-xyz");
  });

  it("resend remains the fallback with no SMTP configured", async () => {
    process.env.RESEND_API_KEY = "re_x";
    vi.stubEnv("NODE_ENV", "development");
    process.env.APP_URL = "http://localhost:4100";
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        requests.push(JSON.parse(init.body));
        return {
          ok: true,
          status: 200,
          headers: { entries: () => [] as Array<[string, string]> },
          text: async () => "",
          json: async () => ({ id: "re_1" }),
        };
      })
    );
    try {
      const result = await sendVerificationEmail({ to: "divyansh151947@gmail.com", token: "verify_z" });
      expect(result.ok).toBe(true);
      expect(result.provider).toBe("resend");
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("no recipient is ever hardcoded", async () => {
    setSmtpEnv();
    vi.stubEnv("NODE_ENV", "development");
    for (const to of ["divyansh151947@gmail.com", "urmiladevi169681@gmail.com", "stranger@example.org"]) {
      sendMailMock.mockClear();
      await sendVerificationEmail({ to, token: "verify_q" });
      expect(sendMailMock.mock.calls[0][0].to).toBe(to);
    }
  });
});
