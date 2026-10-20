import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import {
  getComparisonById,
  updateComparison,
  deleteComparison,
  getComparisonProperties,
  validateComparisonName,
  resolveComparisonProperties,
} from "@/lib/data/buyer";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const comparison = await getComparisonById(userId, id);

    if (!comparison) {
      return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
    }

    const properties = await getComparisonProperties(userId, id);
    return NextResponse.json({ comparison, properties });
  } catch (error) {
    console.error("[buyer/comparisons/[id]] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { name, propertyIds } = body;

    const update: { name?: string | null; propertyIds?: string[] } = {};
    if (name !== undefined) {
      const nameCheck = validateComparisonName(name);
      if (!nameCheck.ok) {
        return NextResponse.json({ error: nameCheck.error }, { status: nameCheck.status });
      }
      update.name = nameCheck.value;
    }
    if (propertyIds !== undefined) {
      const resolved = await resolveComparisonProperties(propertyIds);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }
      update.propertyIds = resolved.ids;
    }
    if (update.name === undefined && update.propertyIds === undefined) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const comparison = await updateComparison(userId, id, update);
    if (!comparison) {
      return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
    }

    return NextResponse.json({ comparison });
  } catch (error) {
    console.error("[buyer/comparisons/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;

    const deleted = await deleteComparison(userId, id);
    if (!deleted) {
      return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[buyer/comparisons/[id]] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
