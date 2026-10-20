import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getVisitRequestById, updateVisitRequest, cancelVisitRequest } from "@/lib/data/buyer";

const UPDATABLE_VISIT_STATUSES = ["CANCELED"] as const;
const MAX_NOTES_LENGTH = 2000;

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
    const visit = await getVisitRequestById(userId, id);

    if (!visit) {
      return NextResponse.json({ error: "Visit request not found" }, { status: 404 });
    }

    return NextResponse.json({ visit });
  } catch (error) {
    console.error("[buyer/visits/[id]] GET error:", error);
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
    const { status, notes } = body;

    const updateData: Record<string, string> = {};
    if (status !== undefined) {
      if (!(UPDATABLE_VISIT_STATUSES as readonly string[]).includes(status)) {
        // Buyers may only cancel their own requests; agent-side transitions
        // (SCHEDULED/CONFIRMED/COMPLETED/NO_SHOW) belong on staff APIs.
        return NextResponse.json({ error: "Buyers may only cancel a visit request" }, { status: 400 });
      }
      updateData.status = status;
    }
    if (notes !== undefined) {
      if (typeof notes !== "string" || notes.length > MAX_NOTES_LENGTH) {
        return NextResponse.json({ error: "Notes must be at most 2000 characters" }, { status: 400 });
      }
      updateData.notes = notes;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const visit = await updateVisitRequest(userId, id, updateData);
    if (!visit) {
      return NextResponse.json({ error: "Visit request not found" }, { status: 404 });
    }

    return NextResponse.json({ visit });
  } catch (error) {
    console.error("[buyer/visits/[id]] PATCH error:", error);
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

    const visit = await getVisitRequestById(userId, id);
    if (!visit) {
      return NextResponse.json({ error: "Visit request not found" }, { status: 404 });
    }

    // Only allow cancellation of pending/confirmed visits
    if (!["REQUESTED", "SCHEDULED", "CONFIRMED"].includes(visit.status)) {
      return NextResponse.json({ error: "Cannot cancel this visit request" }, { status: 400 });
    }

    await cancelVisitRequest(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[buyer/visits/[id]] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
