import { NextRequest, NextResponse } from "next/server";
import { listPublicProperties } from "@/lib/data/properties";
import { chatIpMinuteLimiter, getClientIp, rateLimitedResponse } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  try {
    // Public catalog is unauthenticated; bound per-IP burst like chat GET.
    const ip = getClientIp(req.headers);
    const minuteCheck = await chatIpMinuteLimiter.check(`catalog:ip-minute:${ip}`);
    if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
    const sp = req.nextUrl.searchParams;
    const filters = {
      city: sp.get("city") ?? undefined,
      bhk: sp.get("bhk") ? Number(sp.get("bhk")) : undefined,
      propertyType: sp.get("propertyType") ?? undefined,
      maxPrice: sp.get("maxPrice") ? Number(sp.get("maxPrice")) : undefined,
      minPrice: sp.get("minPrice") ? Number(sp.get("minPrice")) : undefined,
      search: sp.get("search") ?? undefined,
      furnishing: sp.get("furnishing") ?? undefined,
      minArea: sp.get("minArea") ? Number(sp.get("minArea")) : undefined,
      maxArea: sp.get("maxArea") ? Number(sp.get("maxArea")) : undefined,
      possessionTimeline: sp.get("possessionTimeline") ?? undefined,
      sortBy: sp.get("sortBy") ?? undefined,
    };

    const properties = await listPublicProperties(filters);
    return NextResponse.json({ properties });
  } catch (error) {
    console.error("[public/properties] error:", error);
    return NextResponse.json({ error: "Failed to load properties" }, { status: 500 });
  }
}