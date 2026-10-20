import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSavedProperties, saveProperty, unsaveProperty, isPropertySaved, clearSavedProperties } from "@/lib/data/buyer";
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
    const properties = await getSavedProperties(userId);

    return NextResponse.json({ properties });
  } catch (error) {
    console.error("[buyer/saved] GET error:", error);
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
    const propertyId = body.propertyId;

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }

    const property = await getPublicPropertyById(propertyId);
    if (!property) {
      return NextResponse.json({ error: "Property not found or not available" }, { status: 404 });
    }

    const alreadySaved = await isPropertySaved((session.user as any).id, propertyId);
    if (alreadySaved) {
      return NextResponse.json({ error: "Property already saved" }, { status: 409 });
    }

    await saveProperty(userId, propertyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[buyer/saved] POST error:", error);
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
    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      // Explicit "clear everything" mode used by the Danger Zone. Still scoped
      // to the authenticated buyer — never accepts another user's id.
      if (searchParams.get("all") === "true") {
        await clearSavedProperties(userId);
        return NextResponse.json({ ok: true, cleared: true });
      }
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }

    await unsaveProperty(userId, propertyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[buyer/saved] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}