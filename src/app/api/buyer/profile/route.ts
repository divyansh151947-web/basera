import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/buyer/profile — own profile (session-derived, never another user's).
 * PATCH /api/buyer/profile — update own display name / phone only.
 * Email and role are immutable here by design.
 */
export async function GET(_req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as any).role !== "BUYER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = (session.user as any).id as string;
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!rows[0]) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ profile: rows[0] });
  } catch (error) {
    console.error("[buyer/profile] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as any).role !== "BUYER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = (session.user as any).id as string;
    const body = await req.json().catch(() => ({}));
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 1 || name.length > 100) {
        return NextResponse.json({ error: "Name must be 1-100 characters" }, { status: 400 });
      }
      updateData.name = name;
    }
    if (body.phone !== undefined) {
      if (body.phone !== null && String(body.phone).length > 32) {
        return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
      }
      updateData.phone = body.phone;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const rows = await db
      .update(users)
      .set({ ...updateData, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId))
      .returning({ id: users.id, name: users.name, email: users.email, phone: users.phone });
    if (!rows[0]) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ profile: rows[0] });
  } catch (error) {
    console.error("[buyer/profile] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
