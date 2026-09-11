import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { organizations, users, subscriptions, plans, aiConfigs, scoringConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { signupSchema } from "@/lib/validation";

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `org-${Date.now()}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { companyName, name, email, password, phone } = parsed.data;

  const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (existing[0]) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const baseSlug = slugify(companyName);
  let slug = baseSlug;
  let n = 1;
  while ((await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1))[0]) {
    slug = `${baseSlug}-${n++}`;
  }

  const [org] = await db.insert(organizations).values({ name: companyName, slug, phone }).returning();

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
  await db.insert(users).values({
    organizationId: org.id,
    name,
    email: email.toLowerCase(),
    passwordHash,
    role: "BUSINESS_ADMIN",
  });

  return NextResponse.json({ ok: true, organizationSlug: org.slug });
}
