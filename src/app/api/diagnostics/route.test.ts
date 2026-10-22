import { describe, expect, it, vi, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { GET as diagnosticsGET } from "@/app/api/diagnostics/route";
import { resolvePublicChatOrgSlug } from "@/lib/public-chat";

/**
 * Section 9 safe diagnostics: the deployment truth surface must distinguish
 * missing config, provider state, and the public workspace mismatch WITHOUT
 * ever returning a secret, token, full URL, or credential material.
 * Run against the real (local) database to also prove the org-existence
 * boolean agrees with an actual query.
 */

const DIAG_IP = "203.0.113.77";

function get() {
  return new NextRequest("http://localhost/api/diagnostics", {
    method: "GET",
    headers: { "content-type": "application/json", "x-forwarded-for": DIAG_IP },
  });
}

afterAll(async () => {
  // No rows are created by this suite — nothing to clean up.
});

describe("GET /api/diagnostics — safe deployment truth", () => {
  it("returns every deployment truth field with safe enum values", async () => {
    const res = await diagnosticsGET(get());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(["up", "down"]).toContain(body.database);
    expect(typeof body.time === "string" && (body.time as string).startsWith("20")).toBe(true);

    const appUrl = body.appUrl as { configured: boolean; isPublicHttps: boolean };
    expect(typeof appUrl.configured).toBe("boolean");
    expect(typeof appUrl.isPublicHttps).toBe("boolean");

    const email = body.email as { provider: string; senderDomain: string };
    expect(["smtp", "resend", "none"]).toContain(email.provider);
    expect(typeof email.senderDomain).toBe("string");
    expect(email.senderDomain).toMatch(/^(none|unknown|[a-z0-9.-]+\.[a-z]{2,})$/i);

    const ai = body.ai as { provider: string };
    expect(["openai", "anthropic", "gemini", "none"]).toContain(ai.provider);

    const voice = body.voice as { provider: string; configured: boolean };
    expect(typeof voice.provider).toBe("string");
    expect(typeof voice.configured).toBe("boolean");

    const workspace = body.publicWorkspace as { slug: string; exists: boolean };
    expect(workspace.slug).toBe(resolvePublicChatOrgSlug(process.env.NEXT_PUBLIC_PUBLIC_ORG_SLUG));
    const orgRows = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, workspace.slug)).limit(1);
    expect(workspace.exists).toBe(orgRows.length > 0);
  });

  it("never leaks secret values in the payload", async () => {
    const res = await diagnosticsGET(get());
    const text = JSON.stringify(await res.json());
    const secretish = [
      process.env.RESEND_API_KEY,
      process.env.SMTP_PASSWORD,
      process.env.DATABASE_URL,
      process.env.NEXTAUTH_SECRET,
      process.env.ANTHROPIC_API_KEY,
      process.env.GEMINI_API_KEY,
    ];
    for (const secret of secretish) {
      if (secret && secret.length > 8) expect(text.includes(secret)).toBe(false);
    }
  });

  it("is burst-rate-limited per IP", async () => {
    // One fresh IP, sustained burst: the 6/minute budget must stop the
    // 7th+ call with a 429 instead of serving unbounded config truth.
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await diagnosticsGET(
        new NextRequest("http://localhost/api/diagnostics", {
          method: "GET",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.79" },
        })
      );
      statuses.push(res.status);
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(1);
    expect(statuses[0]).toBe(200);
  });
});
