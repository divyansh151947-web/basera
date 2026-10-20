import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getBuyerPreferences, upsertBuyerPreferences } from "@/lib/data/buyer";

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
    const preferences = await getBuyerPreferences(userId);

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("[buyer/preferences] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
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

    const allowedFields = [
      "budgetMinInr",
      "budgetMaxInr",
      "preferredCity",
      "preferredLocality",
      "propertyType",
      "bhk",
      "minAreaSqft",
      "maxAreaSqft",
      "furnishing",
      "possessionTimeline",
      "purpose",
    ];

    const data: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        data[field] = body[field] === "" ? null : body[field];
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Validate numeric fields
    if (data.budgetMinInr !== null && data.budgetMinInr !== undefined && isNaN(Number(data.budgetMinInr))) {
      return NextResponse.json({ error: "Invalid budgetMinInr" }, { status: 400 });
    }
    if (data.budgetMaxInr !== null && data.budgetMaxInr !== undefined && isNaN(Number(data.budgetMaxInr))) {
      return NextResponse.json({ error: "Invalid budgetMaxInr" }, { status: 400 });
    }
    if (data.bhk !== null && data.bhk !== undefined && isNaN(Number(data.bhk))) {
      return NextResponse.json({ error: "Invalid bhk" }, { status: 400 });
    }
    if (data.minAreaSqft !== null && data.minAreaSqft !== undefined && isNaN(Number(data.minAreaSqft))) {
      return NextResponse.json({ error: "Invalid minAreaSqft" }, { status: 400 });
    }
    if (data.maxAreaSqft !== null && data.maxAreaSqft !== undefined && isNaN(Number(data.maxAreaSqft))) {
      return NextResponse.json({ error: "Invalid maxAreaSqft" }, { status: 400 });
    }

    // Validate purpose enum
    if (data.purpose !== null && data.purpose !== undefined && !["BUY", "RENT", "INVEST"].includes(data.purpose)) {
      return NextResponse.json({ error: "Invalid purpose" }, { status: 400 });
    }

    // Range + domain checks (mirrors staff lead validation; buyers must not
    // persist inverted ranges or unbounded values).
    const budgetMin = data.budgetMinInr == null ? null : Number(data.budgetMinInr);
    const budgetMax = data.budgetMaxInr == null ? null : Number(data.budgetMaxInr);
    if (budgetMin != null && (!Number.isInteger(budgetMin) || budgetMin < 0 || budgetMin > 10000000000)) {
      return NextResponse.json({ error: "Invalid budgetMinInr" }, { status: 400 });
    }
    if (budgetMax != null && (!Number.isInteger(budgetMax) || budgetMax < 0 || budgetMax > 10000000000)) {
      return NextResponse.json({ error: "Invalid budgetMaxInr" }, { status: 400 });
    }
    if (budgetMin != null && budgetMax != null && budgetMax < budgetMin) {
      return NextResponse.json({ error: "Maximum budget must be greater than or equal to minimum budget." }, { status: 400 });
    }
    const bhkNum = data.bhk == null ? null : Number(data.bhk);
    if (bhkNum != null && (!Number.isInteger(bhkNum) || bhkNum < 1 || bhkNum > 10)) {
      return NextResponse.json({ error: "Invalid bhk (must be 1-10)" }, { status: 400 });
    }
    const minArea = data.minAreaSqft == null ? null : Number(data.minAreaSqft);
    const maxArea = data.maxAreaSqft == null ? null : Number(data.maxAreaSqft);
    if (minArea != null && (!Number.isInteger(minArea) || minArea < 0 || minArea > 1000000)) {
      return NextResponse.json({ error: "Invalid minAreaSqft" }, { status: 400 });
    }
    if (maxArea != null && (!Number.isInteger(maxArea) || maxArea < 0 || maxArea > 1000000)) {
      return NextResponse.json({ error: "Invalid maxAreaSqft" }, { status: 400 });
    }
    if (minArea != null && maxArea != null && maxArea < minArea) {
      return NextResponse.json({ error: "Maximum area must be greater than or equal to minimum area." }, { status: 400 });
    }
    if (data.propertyType !== null && data.propertyType !== undefined && !["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"].includes(data.propertyType)) {
      return NextResponse.json({ error: "Invalid propertyType" }, { status: 400 });
    }
    if (data.furnishing !== null && data.furnishing !== undefined && !["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"].includes(data.furnishing)) {
      return NextResponse.json({ error: "Invalid furnishing" }, { status: 400 });
    }
    for (const strField of ["preferredCity", "preferredLocality", "possessionTimeline"] as const) {
      if (data[strField] !== null && data[strField] !== undefined && (typeof data[strField] !== "string" || data[strField].length > 120)) {
        return NextResponse.json({ error: `Invalid ${strField}` }, { status: 400 });
      }
    }

    await upsertBuyerPreferences(userId, data);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[buyer/preferences] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}