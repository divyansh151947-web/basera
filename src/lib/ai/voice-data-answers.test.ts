import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { detectVoiceDataIntent, formatVoiceDataAnswer } from "./voice-data-answers";

describe("voice data intent detection (deterministic)", () => {
  it("detects revenue-at-risk questions, not navigation", () => {
    expect(detectVoiceDataIntent("What is my revenue at risk?")).toBe("revenue_at_risk");
    expect(detectVoiceDataIntent("Show me revenue at risk.")).toBe("revenue_at_risk");
    expect(detectVoiceDataIntent("Kitna revenue at risk hai?")).toBe("revenue_at_risk");
  });

  it("detects recovery-attention questions", () => {
    expect(detectVoiceDataIntent("Which leads need attention?")).toBe("recovery_attention");
    expect(detectVoiceDataIntent("Show recovery opportunities.")).toBe("recovery_attention");
    expect(detectVoiceDataIntent("Kaunse leads par dhyaan dun?")).toBe("recovery_attention");
  });

  it("detects follow-up questions but not bare navigation", () => {
    expect(detectVoiceDataIntent("Which leads need follow-up?")).toBe("followups_due");
    expect(detectVoiceDataIntent("Kitne follow-ups due hain?")).toBe("followups_due");
    expect(detectVoiceDataIntent("Open follow-ups.")).toBeNull();
  });

  it("detects next-best-action questions", () => {
    expect(detectVoiceDataIntent("Which lead should I contact first?")).toBe("next_best_action");
    expect(detectVoiceDataIntent("What should I do next?")).toBe("next_best_action");
    expect(detectVoiceDataIntent("Show my highest priority leads.")).toBe("next_best_action");
    expect(detectVoiceDataIntent("Sabse pehle kisse call karoon?")).toBe("next_best_action");
  });

  it("detects upcoming-appointment questions, not booking requests", () => {
    expect(detectVoiceDataIntent("What appointments are upcoming?")).toBe("appointments_upcoming");
    expect(detectVoiceDataIntent("Meri site visits kab hain?")).toBe("appointments_upcoming");
    expect(detectVoiceDataIntent("Book a site visit.")).toBeNull();
    expect(detectVoiceDataIntent("")).toBeNull();
    expect(detectVoiceDataIntent("Hello.")).toBeNull();
  });
});

describe("voice data answer formatting (real numbers in, honest lines out)", () => {
  it("states revenue at risk with counts, never recovered revenue", () => {
    const en = formatVoiceDataAnswer("revenue_at_risk", "en", { totalRevenueAtRisk: 2500000, criticalCount: 2 });
    expect(en).toContain("₹25");
    expect(en).toContain("2 critical");
    expect(en).not.toMatch(/recover/i);
    const hi = formatVoiceDataAnswer("revenue_at_risk", "hi", { totalRevenueAtRisk: 2500000, criticalCount: 2 });
    expect(hi).toContain("₹25");
    const hinglish = formatVoiceDataAnswer("revenue_at_risk", "hinglish", { totalRevenueAtRisk: 2500000, criticalCount: 2 });
    expect(hinglish).toContain("₹25");
    expect(hinglish).not.toMatch(/[ऀ-ॿ]/);
  });

  it("names attention leads honestly, handles the quiet case", () => {
    const some = formatVoiceDataAnswer("recovery_attention", "en", {
      attentionLeads: [{ name: "Aarav" }, { name: null }],
    });
    expect(some).toContain("Aarav");
    expect(some).toContain("An unnamed lead");
    expect(formatVoiceDataAnswer("recovery_attention", "en", { attentionLeads: [] })).toMatch(/no lead/i);
  });

  it("states follow-up counts with zero-state honesty", () => {
    expect(formatVoiceDataAnswer("followups_due", "en", { followUpsDue: 3 })).toContain("3 follow-ups are due");
    expect(formatVoiceDataAnswer("followups_due", "hinglish", { followUpsDue: 0 })).toMatch(/due nahi/i);
  });

  it("names the top next-best-action lead with a humanized step", () => {
    const line = formatVoiceDataAnswer("next_best_action", "en", {
      nextAction: { leadName: "Meera", action: "BOOK_SITE_VISIT" },
    });
    expect(line).toContain("Meera");
    expect(line).toContain("book a site visit");
    expect(formatVoiceDataAnswer("next_best_action", "hi", { nextAction: null })).toMatch(/shaant/i);
  });

  it("states upcoming appointments with zero-state honesty", () => {
    expect(
      formatVoiceDataAnswer("appointments_upcoming", "en", { upcomingCount: 2, nextApptLabel: "12 Jun, 4:00 pm" })
    ).toContain("2 upcoming appointments");
    expect(formatVoiceDataAnswer("appointments_upcoming", "en", { upcomingCount: 0, nextApptLabel: null })).toMatch(
      /no upcoming appointments/i
    );
  });
});
