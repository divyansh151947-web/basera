import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizeWorkspaceName, isUniqueViolation, validateForgotPasswordInput, validatePasswordResetInput, validateSignupInput, propertySchema, propertyUpdateSchema } from "./validation";

describe("signup validation", () => {
  it("accepts a valid signup payload", () => {
    expect(
      validateSignupInput({
        companyName: "UrbanNest Realty",
        name: "Rohit Malhotra",
        email: "rohit@urbannest.demo",
        password: "demo1234",
        phone: "9876543210",
      })
    ).toBeNull();
  });

  it("requires a company name", () => {
    expect(validateSignupInput({ companyName: "", name: "Rohit", email: "rohit@test.com", password: "demo1234" })?.message).toBe("Company name is required.");
  });

  it("requires a name", () => {
    expect(validateSignupInput({ companyName: "UrbanNest", name: "", email: "rohit@test.com", password: "demo1234" })?.message).toBe("Your name is required.");
  });

  it("requires a valid email", () => {
    expect(validateSignupInput({ companyName: "UrbanNest", name: "Rohit", email: "not-an-email", password: "demo1234" })?.message).toBe("Please enter a valid email address.");
  });

  it("requires a password with at least 8 characters", () => {
    expect(validateSignupInput({ companyName: "UrbanNest", name: "Rohit", email: "rohit@test.com", password: "short" })?.message).toBe("Password must be at least 8 characters.");
  });

  it("normalizes mixed-case email addresses before validation", () => {
    expect(normalizeEmail("  Rohit@UrbanNest.demo ")).toBe("rohit@urbannest.demo");
  });

  it("accepts a valid forgot-password payload", () => {
    expect(validateForgotPasswordInput({ email: "  ADMIN@URBANNEST.DEMO  " })).toBeNull();
  });

  it("accepts a valid reset-password payload", () => {
    expect(validatePasswordResetInput({ token: "abc123", password: "newSecurePassword123" })).toBeNull();
  });

  it("rejects reset-password payloads with a short password", () => {
    expect(validatePasswordResetInput({ token: "abc123", password: "short" })?.message).toBe("Password must be at least 8 characters.");
  });
});

describe("property update validation", () => {
  it("accepts a valid partial update", () => {
    expect(propertyUpdateSchema.safeParse({ projectName: "Ivy Greens", availability: "LIMITED" }).success).toBe(true);
  });

  it("accepts a single-field update", () => {
    expect(propertyUpdateSchema.safeParse({ priceMaxInr: 9500000 }).success).toBe(true);
  });

  it("accepts an empty update object", () => {
    expect(propertyUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an invalid field value", () => {
    const parsed = propertyUpdateSchema.safeParse({ availability: "SOLD_TOMORROW" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an inverted price range when both bounds are present", () => {
    const parsed = propertyUpdateSchema.safeParse({ priceMinInr: 9000000, priceMaxInr: 8000000 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Maximum price must be greater than or equal to minimum price.");
    }
  });

  it("keeps the full create schema strict", () => {
    expect(propertySchema.safeParse({ projectName: "Only a name" }).success).toBe(false);
  });
});

describe("workspace creation normalization (Batch 7)", () => {
  it("treats email case and surrounding whitespace consistently", () => {
    expect(normalizeEmail("  Test@Example.com ")).toBe("test@example.com");
    expect(normalizeEmail("TEST@EXAMPLE.COM")).toBe(normalizeEmail("test@example.com"));
    expect(normalizeEmail(null)).toBe("");
  });

  it("normalizes workspace names for duplicate detection", () => {
    expect(normalizeWorkspaceName("  UrbanNest   Realty ")).toBe("urbannest realty");
    expect(normalizeWorkspaceName("URBANNEST REALTY")).toBe(normalizeWorkspaceName("urbannest realty"));
    expect(normalizeWorkspaceName("")).toBe("");
  });

  it("detects uniqueness violations across SQLite and PostgreSQL shapes", () => {
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: users.email"))).toBe(true);
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "user_email_idx"'))).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("connection reset"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
