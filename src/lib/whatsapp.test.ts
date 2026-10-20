import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { normalizeWhatsAppPhone, parseWhatsAppWebhook, sendWhatsAppText, isValidWhatsAppSignature } from "./whatsapp";
import { POST as webhookPOST, GET as webhookGET } from "@/app/api/webhooks/whatsapp/route";
import { db } from "@/db/client";
import { leads } from "@/db/schema";

describe("WhatsApp webhook parsing", () => {
  const textEvent = {
    entry: [{ id: "business-account-1", changes: [{ value: {
      metadata: { phone_number_id: "phone-1" },
      contacts: [{ wa_id: "919876543210", profile: { name: "Asha" } }],
      messages: [{ id: "wamid.1", from: "919876543210", timestamp: "1720000000", type: "text", text: { body: "  3 BHK in Jaiupr  " } }],
    } }] }],
  };

  it("extracts a supported text message and normalizes its sender", () => {
    expect(parseWhatsAppWebhook(textEvent)).toEqual([{
      phoneNumberId: "phone-1", businessAccountId: "business-account-1", from: "919876543210", profileName: "Asha", messageId: "wamid.1", timestamp: "1720000000", text: "3 BHK in Jaiupr",
    }]);
    expect(normalizeWhatsAppPhone("+91 (98765) 43210")).toBe("919876543210");
  });

  it("safely ignores malformed, status-only, and unsupported events", () => {
    expect(parseWhatsAppWebhook(null)).toEqual([]);
    expect(parseWhatsAppWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-1" }, messages: [{ id: "x", from: "1", timestamp: "1", type: "image" }] } }] }] })).toEqual([]);
  });

  it("sends through the resolved tenant phone number and handles Meta errors without leaking credentials", async () => {
    const previousToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const previousPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_ACCESS_TOKEN = "secret-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "default-phone";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.outbound" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendWhatsAppText("+91 98765 43210", "Hello", { phoneNumberId: "tenant-phone" })).resolves.toEqual({ messageId: "wamid.outbound" });
    expect(fetchMock.mock.calls[0][0]).toContain("/tenant-phone/messages");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ to: "919876543210", text: { body: "Hello" } });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid OAuth token" } }) });
    await expect(sendWhatsAppText("919876543210", "Hello")).rejects.toThrow("Invalid OAuth token");
    process.env.WHATSAPP_ACCESS_TOKEN = previousToken;
    process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhone;
    vi.unstubAllGlobals();
  });
});

describe("WhatsApp webhook signature verification (fail closed)", () => {
  const previousSecret = process.env.WHATSAPP_APP_SECRET;
  const previousVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  afterEach(() => {
    process.env.WHATSAPP_APP_SECRET = previousSecret;
    process.env.WHATSAPP_VERIFY_TOKEN = previousVerifyToken;
  });

  function sign(body: string, secret: string) {
    return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  }

  const forgedBody = JSON.stringify({
    entry: [{ id: "evil-account", changes: [{ value: {
      metadata: { phone_number_id: "attacker-phone" },
      contacts: [{ wa_id: "910000000000" }],
      messages: [{ id: "wamid.forged", from: "910000000000", timestamp: "1720000000", type: "text", text: { body: "Hello" } }],
    } }] }],
  });

  function postRequest(body: string, signature: string | null) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (signature) headers["x-hub-signature-256"] = signature;
    return new NextRequest("http://localhost/api/webhooks/whatsapp", { method: "POST", headers, body });
  }

  it("accepts a valid signature when the app secret is configured", () => {
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    expect(isValidWhatsAppSignature(forgedBody, sign(forgedBody, "test-app-secret"))).toBe(true);
  });

  it("rejects an invalid signature", () => {
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    expect(isValidWhatsAppSignature(forgedBody, sign(forgedBody, "wrong-secret"))).toBe(false);
  });

  it("rejects a malformed signature and a missing signature", () => {
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    expect(isValidWhatsAppSignature(forgedBody, "not-a-signature")).toBe(false);
    expect(isValidWhatsAppSignature(forgedBody, null)).toBe(false);
  });

  it("FAILS CLOSED when WHATSAPP_APP_SECRET is missing — even with a plausible signature", () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect(isValidWhatsAppSignature(forgedBody, sign(forgedBody, "anything"))).toBe(false);
    expect(isValidWhatsAppSignature(forgedBody, null)).toBe(false);
  });

  it("unsigned POST is rejected with a generic 401 and creates no leads", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const before = (await db.select({ id: leads.id }).from(leads)).length;
    const res = await webhookPOST(postRequest(forgedBody, null));
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "Invalid signature" });
    expect(JSON.stringify(body)).not.toMatch(/secret|token|wamid|attacker-phone/i);
    const after = (await db.select({ id: leads.id }).from(leads)).length;
    expect(after).toBe(before);
  });

  it("wrongly-signed POST is rejected before any business logic runs", async () => {
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    const res = await webhookPOST(postRequest(forgedBody, sign(forgedBody, "forged-secret")));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
  });

  it("GET verification still succeeds with the correct verify token", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
    const res = await webhookGET(
      new NextRequest("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE123")
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("CHALLENGE123");
  });

  it("GET verification fails with a wrong verify token", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
    const res = await webhookGET(
      new NextRequest("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE123")
    );
    expect(res.status).toBe(403);
  });
});
