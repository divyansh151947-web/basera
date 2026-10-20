import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";

/**
 * GET /api/healthz — minimal production health probe (PART U).
 *
 * Unauthenticated by design (load balancers / uptime monitors call it
 * without credentials). Returns liveness plus database reachability only —
 * no tenant data, no counts, no versions, no secrets, no PII.
 */
export async function GET() {
  let database: "up" | "down" = "down";
  try {
    await db.select({ id: organizations.id }).from(organizations).limit(1);
    database = "up";
  } catch {
    database = "down";
  }
  const status = database === "up" ? 200 : 503;
  return NextResponse.json(
    { ok: database === "up", database, time: new Date().toISOString() },
    { status }
  );
}
