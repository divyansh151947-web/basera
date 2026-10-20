import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { organizations, users, subscriptions, plans, aiConfigs, scoringConfigs } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { normalizeSignupInput, normalizeWorkspaceName, isUniqueViolation, signupSchema, validateSignupInput } from "@/lib/validation";
import { getClientIp, rateLimitedResponse, signupIpLimiter } from "@/lib/rate-limit";
import { createEmailVerification } from "@/lib/email-verification";
import { sendVerificationEmail } from "@/lib/email";

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `org-${Date.now()}`;
}

export async function POST(req: NextRequest) {
  // Mass-registration throttle (H-2): per-IP budget on workspace creation.
  const ipCheck = await signupIpLimiter.check(`signup:ip:${getClientIp(req.headers)}`);
  if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);

  const body = await req.json().catch(() => ({}));
  const normalized = normalizeSignupInput(body);
  const validation = validateSignupInput(normalized);

  if (validation) {
    return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(normalized);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please check your details and try again." }, { status: 400 });
  }

  const { companyName, name, email, password, phone } = parsed.data;

  const existing = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing[0]) {
    // Explicit duplicate signal for the workspace-creation flow (Batch 7):
    // the user must know this email is taken instead of silently falling
    // through to a doomed auto-login. Login/forgot-password/reset keep
    // their generic responses — only this creation endpoint is explicit.
    return NextResponse.json(
      { error: "This email is already registered. Please use another email or log in.", code: "EMAIL_EXISTS" },
      { status: 409 }
    );
  }

  // Workspace-name duplicate check (Batch 7): exact match on the normalized
  // name (trimmed, case-insensitive, collapsed whitespace). Slugs stay
  // unique via the existing suffix scheme, but an identical workspace name
  // is rejected so two workspaces never share a display identity.
  const normalizedCompanyName = normalizeWorkspaceName(companyName);
  const sameName = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`lower(trim(${organizations.name})) = ${normalizedCompanyName}`)
    .limit(1);
  if (sameName[0]) {
    return NextResponse.json(
      { error: "This workspace name is already in use. Please choose another name.", code: "WORKSPACE_EXISTS" },
      { status: 409 }
    );
  }

  const baseSlug = slugify(companyName);
  let slug = baseSlug;
  let n = 1;
  while ((await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1))[0]) {
    slug = `${baseSlug}-${n++}`;
  }

  // Creation is sequential (org → plan → configs → user). If anything fails
  // after the org row exists, remove it so a partial signup can never leave
  // a broken workspace behind; the unique slug/email indexes remain the
  // race-safe backstop and map to the same user-facing messages.
  let orgId: string | null = null;
  try {
    const [org] = await db.insert(organizations).values({ name: companyName, slug, phone }).returning();
    orgId = org.id;

    const starterPlan = (await db.select().from(plans).where(eq(plans.tier, "STARTER")).limit(1))[0];
    if (starterPlan) {
      await db.insert(subscriptions).values({
        organizationId: org.id,
        planId: starterPlan.id,
        status: "TRIALING",
        trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      });
    }

    await db.insert(aiConfigs).values({ organizationId: org.id });
    await db.insert(scoringConfigs).values({ organizationId: org.id, weightsJson: "{}" });

    const passwordHash = await bcrypt.hash(password, 12);
    const [newUser] = await db.insert(users).values({
      organizationId: org.id,
      name,
      email,
      phone: phone ?? null,
      passwordHash,
      role: "BUSINESS_ADMIN",
    }).returning();

  // Email verification (Batch 1B-3): best-effort welcome verification mail.
  // Never blocks signup and never leaks the token: failures (e.g. Resend
  // unconfigured locally) are logged without any secret, and the account
  // can request another link via the resend endpoint at any time.
  try {
    const { rawToken } = await createEmailVerification(newUser.id);
    const result = await sendVerificationEmail({ to: email, name, token: rawToken });
    if (!result.ok) {
      console.warn("[auth] Signup verification email deferred.", { userId: newUser.id, reason: result.reason });
    }
  } catch (error) {
    console.error("[auth] Signup verification setup failed.", { userId: newUser.id });
  }

    return NextResponse.json({ ok: true, organizationSlug: org.slug });
  } catch (error) {
    // Roll back a partially created workspace so no broken account remains.
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId)).catch(() => {});
    }
    // Race-safe backstop: a concurrent request may have won the unique
    // email/slug insert first — map constraint failures to the same safe
    // duplicate messages instead of leaking database errors.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "This email or workspace name is already in use. Please use another email or choose another name.", code: "ALREADY_EXISTS" },
        { status: 409 }
      );
    }
    console.error("[auth] Workspace creation failed.", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
