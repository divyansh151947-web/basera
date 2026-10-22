import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { isUniqueViolation, normalizeBuyerSignupInput, validateBuyerSignupInput, buyerSignupSchema } from "@/lib/validation";
import { getClientIp, rateLimitedResponse, signupIpLimiter } from "@/lib/rate-limit";
import { createEmailVerification } from "@/lib/email-verification";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  // Rate limiting (same as workspace creation)
  const ipCheck = await signupIpLimiter.check(`signup:ip:${getClientIp(req.headers)}`);
  if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);

  const body = await req.json().catch(() => ({}));
  const normalized = normalizeBuyerSignupInput(body);
  const validation = validateBuyerSignupInput(normalized);

  if (validation) {
    return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
  }

  const parsed = buyerSignupSchema.safeParse(normalized);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please check your details and try again." }, { status: 400 });
  }

  const { name, email, password, phone } = parsed.data;

  const existing = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing[0]) {
    return NextResponse.json(
      { error: "This email is already registered. Please use another email or log in.", code: "EMAIL_EXISTS" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let newUser;
  try {
    [newUser] = await db.insert(users).values({
      organizationId: null, // Buyers don't belong to an organization
      name,
      email,
      phone: phone ?? null,
      passwordHash,
      role: "BUYER",
    }).returning();
  } catch (error) {
    // Race-safe backstop: a concurrent request may have won the unique email
    // insert first — map constraint failures to the same safe duplicate
    // message instead of leaking database errors or returning 500.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "This email is already registered. Please use another email or log in.", code: "EMAIL_EXISTS" },
        { status: 409 }
      );
    }
    console.error("[auth] Buyer signup insert failed.", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Email verification
  try {
    const { rawToken } = await createEmailVerification(newUser.id);
    const result = await sendVerificationEmail({ to: email, name, token: rawToken });
    if (!result.ok) {
      console.warn("[auth] Buyer signup verification email deferred.", { userId: newUser.id, reason: result.reason });
    }
  } catch (error) {
    console.error("[auth] Buyer signup verification setup failed.", { userId: newUser.id });
  }

  return NextResponse.json({ ok: true });
}