import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/healthz", () => {
  it("returns liveness with database reachability and nothing sensitive", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.database).toBe("up");
    expect(typeof body.time).toBe("string");
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/password|secret|token|key|url|lead|user|email/i);
  });
});
