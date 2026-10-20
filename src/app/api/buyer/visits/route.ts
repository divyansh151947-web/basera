import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getVisitRequests, createVisitRequest, getVisitRequestById, updateVisitRequest, cancelVisitRequest } from "@/lib/data/buyer";
import { getPublicPropertyById } from "@/lib/data/properties";

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
    const visits = await getVisitRequests(userId);

// Enrich with property details
    const enrichedVisits = await Promise.all(
      visits.map(async (visit) => {
        const property = await getPublicPropertyById(visit.propertyId);
        return {
          ...visit,
          property: property?.property ?? null,
        };
      })
    );

    return NextResponse.json({ visits: enrichedVisits });
  } catch (error) {
    console.error("[buyer/visits] GET error:", error);
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
    const { propertyId, scheduledAt, notes } = body;

    if (!propertyId || !scheduledAt) {
      return NextResponse.json({ error: "Property ID and scheduled date/time are required" }, { status: 400 });
    }

    // Validate scheduledAt is a future date
    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      return NextResponse.json({ error: "Scheduled date must be in the future" }, { status: 400 });
    }

    // Verify property exists and is available
    const property = await getPublicPropertyById(propertyId);
    if (!property) {
      return NextResponse.json({ error: "Property not found or not available" }, { status: 404 });
    }

    if (notes !== undefined && (typeof notes !== "string" || notes.length > 2000)) {
      return NextResponse.json({ error: "Notes must be at most 2000 characters" }, { status: 400 });
    }

    const visit = await createVisitRequest(userId, propertyId, scheduledAt, notes);
    return NextResponse.json({ visit }, { status: 201 });
  } catch (error) {
    console.error("[buyer/visits] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}