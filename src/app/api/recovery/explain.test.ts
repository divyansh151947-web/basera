import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fallbackExplanation } from "@/lib/ai/recovery-explanation";

describe("recovery AI explanation fallback (grounded, no fabrication)", () => {
  it("names only the facts on record", () => {
    const out = fallbackExplanation({
      leadName: "Riya Mehta",
      riskLevel: "HIGH",
      riskScore: 68,
      leadScore: 72,
      lastInboundHoursAgo: 30,
      recommendedAction: "FOLLOW_UP",
      reasons: ["No customer reply in 2 days.", "A follow-up is overdue."],
    });
    expect(out).toContain("Riya Mehta");
    expect(out).toContain("72/100");
    expect(out).toContain("high revenue risk");
    expect(out).toContain("30 hours ago");
    expect(out).toContain("follow up");
    expect(out).toContain("No customer reply in 2 days.");
  });

  it("handles a lead with no name and no message on record", () => {
    const out = fallbackExplanation({
      leadName: null,
      riskLevel: "LOW",
      riskScore: 12,
      leadScore: 20,
      lastInboundHoursAgo: null,
      recommendedAction: null,
      reasons: ["Lead shows fresh engagement and no missed follow-ups."],
    });
    expect(out).toContain("This lead");
    expect(out).toContain("no recorded customer message on file");
    expect(out).not.toContain("Recommended next step");
  });

  it("does not invent conversations, people, or outcomes", () => {
    const out = fallbackExplanation({
      leadName: "A. Rahman",
      riskLevel: "CRITICAL",
      riskScore: 90,
      leadScore: 88,
      lastInboundHoursAgo: 5,
      recommendedAction: "RESPOND_TO_CUSTOMER",
      reasons: ["Customer wrote in but has no recorded agent response."],
    });
    // Must not promise conversion or mention channels we do not know.
    expect(out).not.toMatch(/will convert|guarantee|email|whatsapp|call/i);
    expect(out).toContain("respond to customer");
  });
});
