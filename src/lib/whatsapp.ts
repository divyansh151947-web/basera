import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

export interface WhatsAppInboundMessage {
  phoneNumberId: string;
  businessAccountId?: string;
  from: string;
  profileName?: string;
  messageId: string;
  timestamp: string;
  text: string;
}

type MetaPayload = { entry?: Array<{ id?: string; changes?: Array<{ value?: { metadata?: { phone_number_id?: string; display_phone_number?: string }; contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>; messages?: Array<{ id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }> } }> }> };

export function normalizeWhatsAppPhone(value: string) {
  return value.replace(/\D/g, "").replace(/^0+/, "");
}

export function parseWhatsAppWebhook(payload: unknown): WhatsAppInboundMessage[] {
  const body = payload as MetaPayload;
  if (!body || !Array.isArray(body.entry)) return [];
  const result: WhatsAppInboundMessage[] = [];
  for (const entry of body.entry) for (const change of entry.changes ?? []) {
    const value = change.value;
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId) continue;
    for (const message of value?.messages ?? []) {
      if (message.type !== "text" || !message.id || !message.from || !message.timestamp || !message.text?.body?.trim()) continue;
      const contact = value?.contacts?.find((item) => item.wa_id === message.from);
      result.push({ phoneNumberId, businessAccountId: entry.id, from: normalizeWhatsAppPhone(message.from), profileName: contact?.profile?.name?.trim() || undefined, messageId: message.id, timestamp: message.timestamp, text: message.text.body.trim() });
    }
  }
  return result;
}

export function isValidWhatsAppSignature(rawBody: string, signature: string | null) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  // FAIL CLOSED (Batch 1B-2): without an app secret there is no way to
  // authenticate the sender, so verification MUST fail. The previous
  // fail-open behavior (returning true here) let anyone forge webhook
  // events and trigger lead creation + AI spend. Never fall back to a
  // default, hardcoded, or empty secret.
  if (!appSecret) return false;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function sendWhatsAppText(to: string, body: string, options: { phoneNumberId?: string } = {}) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = options.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phoneNumberId) throw new Error("WhatsApp outbound messaging is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: normalizeWhatsAppPhone(to), type: "text", text: { preview_url: false, body: body.slice(0, 4096) } }),
    });
    const json = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } } | null;
    if (!response.ok || !json?.messages?.[0]?.id) throw new Error(json?.error?.message || `WhatsApp API returned HTTP ${response.status}`);
    return { messageId: json.messages[0].id };
  } finally { clearTimeout(timeout); }
}
