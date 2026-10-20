import { describe, expect, it } from "vitest";
import { signupSchema, buyerSignupSchema, leadCreateSchema, appointmentSchema } from "./validation";

/**
 * Registration privilege-escalation guard (Step 2, Phase B/D).
 *
 * Public signup inputs must never carry role / organization / user identity:
 * zod strips unknown keys by default, and the schemas below do not declare
 * such fields — so even a crafted request body cannot mint staff roles or
 * join an arbitrary organization. The routes additionally hardcode the role.
 */
describe("public schemas reject privilege-escalation fields", () => {
  it("staff signup strips role and organizationId", () => {
    const parsed = signupSchema.safeParse({
      companyName: "Acme",
      name: "Acme Owner",
      email: "a@acme.test",
      password: "password123",
      role: "SUPER_ADMIN",
      organizationId: "org-victim",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("role");
      expect(parsed.data).not.toHaveProperty("organizationId");
    }
  });

  it("buyer signup strips role and organizationId", () => {
    const parsed = buyerSignupSchema.safeParse({
      name: "Buyer Bee",
      email: "b@test.example",
      password: "password123",
      role: "BUSINESS_ADMIN",
      organizationId: "org-victim",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("role");
      expect(parsed.data).not.toHaveProperty("organizationId");
    }
  });

  it("lead creation strips organizationId and userId", () => {
    const parsed = leadCreateSchema.safeParse({
      name: "Lead",
      source: "MANUAL",
      organizationId: "org-victim",
      userId: "user-victim",
      role: "SUPER_ADMIN",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("organizationId");
      expect(parsed.data).not.toHaveProperty("userId");
      expect(parsed.data).not.toHaveProperty("role");
    }
  });

  it("appointment creation strips organization fields", () => {
    const parsed = appointmentSchema.safeParse({
      leadId: "lead-1",
      type: "SITE_VISIT",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      organizationId: "org-victim",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("organizationId");
    }
  });
});
