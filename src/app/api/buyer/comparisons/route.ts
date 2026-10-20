import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import {
  getComparisons,
  createComparison,
  validateComparisonName,
  resolveComparisonProperties,
} from "@/lib/data/buyer";

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as any).role;
    if (role !== "BUYER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = (session.user as any).id;
    const comparisons = await getComparisons(userId);

    return NextResponse.json({ comparisons });
  } catch (error) {
    console.error("[buyer/comparisons] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as any).role;
    if (role !== "BUYER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = (session.user as any).id;
    const body = await req.json().catch(() => ({}));
    const { name, propertyIds } = body;

    const nameCheck = validateComparisonName(name);
    if (!nameCheck.ok) {
      return NextResponse.json({ error: nameCheck.error }, { status: nameCheck.status });
    }
    const resolved = await resolveComparisonProperties(propertyIds);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const comparison = await createComparison(userId, nameCheck.value, resolved.ids);
    return NextResponse.json({ comparison }, { status: 201 });
  } catch (error) {
    console.error("[buyer/comparisons] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}