import { NextRequest, NextResponse } from "next/server";
import { createLead, getLeadByPhone } from "@/lib/data/leads";
import { getMessageByExternalId, getOrCreateConversationForLead, updateMessageMetadata } from "@/lib/data/conversations";
import { getWhatsAppIntegrationByPhoneNumberId } from "@/lib/data/integrations";
import { processInboundMessage } from "@/lib/ai/conversation-agent";
import { isValidWhatsAppSignature, parseWhatsAppWebhook, sendWhatsAppText } from "@/lib/whatsapp";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const verifyToken = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && process.env.WHATSAPP_VERIFY_TOKEN && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!isValidWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Malformed webhook payload" }, { status: 400 }); }

  const inbound = parseWhatsAppWebhook(payload);
  // Status callbacks and unsupported message types are valid Meta events.
  if (!inbound.length) return NextResponse.json({ received: true }, { status: 200 });

  for (const message of inbound) {
    try {
      if (await getMessageByExternalId(message.messageId)) continue;
      const resolved = await getWhatsAppIntegrationByPhoneNumberId(message.phoneNumberId);
      if (!resolved) { console.warn("[whatsapp] ignored message for unregistered phone number", { phoneNumberId: message.phoneNumberId }); continue; }
      const organizationId = resolved.integration.organizationId;
      let lead = await getLeadByPhone(organizationId, message.from);
      if (!lead) lead = await createLead(organizationId, { source: "WHATSAPP", phone: message.from, name: message.profileName });
      const conversation = await getOrCreateConversationForLead(organizationId, lead.id, "WHATSAPP");
      const result = await processInboundMessage(organizationId, conversation.id, lead.id, message.text, {
        inboundExternalMessageId: message.messageId,
        inboundMetadata: { channel: "WHATSAPP", timestamp: message.timestamp, phoneNumberId: message.phoneNumberId },
        outboundMetadata: { channel: "WHATSAPP", deliveryStatus: "pending" },
      });
      try {
        const sent = await sendWhatsAppText(message.from, result.reply, { phoneNumberId: resolved.config.phoneNumberId });
        if (result.outboundMessageId) await updateMessageMetadata(result.outboundMessageId, { channel: "WHATSAPP", deliveryStatus: "accepted", externalMessageId: sent.messageId });
      } catch (error) {
        if (result.outboundMessageId) await updateMessageMetadata(result.outboundMessageId, { channel: "WHATSAPP", deliveryStatus: "failed" });
        console.error("[whatsapp] outbound delivery failed", { organizationId, conversationId: conversation.id, error: error instanceof Error ? error.message : "unknown" });
      }
    } catch (error) {
      // Return 200 so one malformed/failed event does not make Meta replay an
      // entire batch indefinitely. The external message-id remains the retry key.
      if (!(error instanceof Error && /UNIQUE constraint failed: messages.external_message_id/.test(error.message))) {
        console.error("[whatsapp] inbound processing failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    }
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
