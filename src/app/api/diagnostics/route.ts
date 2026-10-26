import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { getClientIp, diagnosticsIpLimiter, rateLimitedResponse } from "@/lib/rate-limit";
import {
  getActiveEmailProvider,
  getActiveSenderDomain,
  getAppUrl,
  isPublicAppUrl,
} from "@/lib/email";
import { activeAIProvider } from "@/lib/ai/ai-provider";
import { getVoiceProviderName } from "@/lib/voice/voice-provider";
import { createProviderById } from "@/lib/voice/voice-session";
import { resolvePublicChatOrgSlug } from "@/lib/public-chat";

/**
 * GET /api/diagnostics — SAFE deployment truth for the OWNER (Section 9).
 *
 * Diagnosing Voice AI / chatbot / email / reset failures previously required
 * Vercel log access: the public routes fail closed with generic honest
 * errors (by design — no tenant data, no config internals, no enumeration).
 * This endpoint answers the configuration questions WITHOUT ever exposing
 * secrets, tokens, URLs, or emails:
 *
 *  - which email provider is actually selected (smtp > brevo > resend > none) and
 *    the sender domain it would send from;
 *  - whether APP_URL/NEXTAUTH_URL is configured and passes the public-HTTPS
 *    guard that verification/reset links are generated from;
 *  - which AI provider the conversation agent prefers (anthropic/openai/
 *    gemini/none);
 *  - which voice provider VOICE_PROVIDER selects and whether it is actually
 *    configured at runtime (fail-closed rule from voice-session);
 *  - the public workspace slug the site serves and whether a matching
 *    organization row exists in the CURRENT database (this is exactly the
 *    404 "Unknown business" root cause, made legible);
 *  - database reachability.
 *
 * Everything returned is a boolean, an enum name, the public slug, or a
 * sender DOMAIN — no credentials, no counts, no PII. Burst-limited per IP.
 */
export async function GET(req: NextRequest) {
  const ipCheck = await diagnosticsIpLimiter.check(`diagnostics:ip:${getClientIp(req.headers)}`);
  if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);

  let database: "up" | "down" = "down";
  try {
    await db.select({ id: organizations.id }).from(organizations).limit(1);
    database = "up";
  } catch {
    database = "down";
  }

  const voiceProviderName = getVoiceProviderName();
  let voiceProviderConfigured = false;
  try {
    await createProviderById(voiceProviderName);
    voiceProviderConfigured = true;
  } catch {
    voiceProviderConfigured = false;
  }

  const publicWorkspaceSlug = resolvePublicChatOrgSlug(process.env.NEXT_PUBLIC_PUBLIC_ORG_SLUG);
  let publicWorkspaceExists = false;
  let publicWorkspaceIsDemo: boolean | null = null;
  if (database === "up") {
    try {
      const org = (
        await db
          .select({ isDemo: organizations.isDemo })
          .from(organizations)
          .where(eq(organizations.slug, publicWorkspaceSlug))
          .limit(1)
      )[0];
      publicWorkspaceExists = Boolean(org);
      publicWorkspaceIsDemo = org ? Boolean(org.isDemo) : null;
    } catch {
      // Stay with the falsy defaults rather than failing the whole probe.
    }
  }

  return NextResponse.json({
    time: new Date().toISOString(),
    database,
    appUrl: {
      configured: Boolean(process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim()),
      isPublicHttps: isPublicAppUrl(getAppUrl()),
    },
    email: {
      provider: getActiveEmailProvider(),
      senderDomain: getActiveSenderDomain(),
    },
    ai: { provider: activeAIProvider() },
    voice: {
      provider: voiceProviderName,
      configured: voiceProviderConfigured,
    },
    publicWorkspace: {
      slug: publicWorkspaceSlug,
      exists: publicWorkspaceExists,
      isDemo: publicWorkspaceIsDemo,
    },
  });
}
