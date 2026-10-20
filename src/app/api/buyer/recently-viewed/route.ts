import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRecentlyViewedProperties, recordPropertyView, clearRecentlyViewed } from "@/lib/data/buyer";
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
    const properties = await getRecentlyViewedProperties(userId, 20);

    return NextResponse.json({ properties });
  } catch (error) {
    console.error("[buyer/recently-viewed] GET error:", error);
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
    const { propertyId } = body;

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }

    const property = await getPublicPropertyById(propertyId);
    if (!property) {
      return NextResponse.json({ error: "Property not found or not available" }, { status: 404 });
    }

    await recordPropertyView(userId, propertyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[buyer/recently-viewed] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
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
    await clearRecentlyViewed(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[buyer/recently-viewed] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}