import { describe, expect, it } from "vitest";
import { resolveLoginDestination } from "./auth-client";

/**
 * Separated login pages must route by the authenticated session role —
 * never by client-supplied parameters (Step 2, Phase B).
 */
describe("resolveLoginDestination", () => {
  it("staff page sends buyers to the buyer workspace", () => {
    expect(resolveLoginDestination("BUYER", "staff")).toEqual({ destination: "/buyer" });
  });

  it("staff page sends staff roles to the dashboard", () => {
    for (const role of ["SALES_AGENT", "MANAGER", "BUSINESS_ADMIN", "SUPER_ADMIN"]) {
      expect(resolveLoginDestination(role, "staff")).toEqual({ destination: "/dashboard" });
    }
  });

  it("staff page falls back to the dashboard when the role is unknown", () => {
    expect(resolveLoginDestination(undefined, "staff")).toEqual({ destination: "/dashboard" });
    expect(resolveLoginDestination(null, "staff")).toEqual({ destination: "/dashboard" });
  });

  it("buyer page admits only buyers", () => {
    expect(resolveLoginDestination("BUYER", "buyer")).toEqual({ destination: "/buyer" });
    for (const role of ["SALES_AGENT", "MANAGER", "BUSINESS_ADMIN", "SUPER_ADMIN", undefined, null]) {
      expect(resolveLoginDestination(role, "buyer")).toEqual({ error: "wrong-account-type" });
    }
  });
});
