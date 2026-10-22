import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLIC_CHAT_ORG_SLUG,
  isPublicOrgUnavailableError,
  PUBLIC_ORG_UNAVAILABLE_MESSAGE,
  resolvePublicChatOrgSlug,
} from "@/lib/public-chat";

describe("public chat workspace selection", () => {
  it("falls back to the seeded demo workspace for empty input", () => {
    expect(resolvePublicChatOrgSlug(undefined)).toBe(DEFAULT_PUBLIC_CHAT_ORG_SLUG);
    expect(resolvePublicChatOrgSlug(null)).toBe(DEFAULT_PUBLIC_CHAT_ORG_SLUG);
    expect(resolvePublicChatOrgSlug("")).toBe(DEFAULT_PUBLIC_CHAT_ORG_SLUG);
    expect(resolvePublicChatOrgSlug("   ")).toBe(DEFAULT_PUBLIC_CHAT_ORG_SLUG);
  });

  it("uses a configured workspace slug after trimming", () => {
    expect(resolvePublicChatOrgSlug("Acme Realty")).toBe("Acme Realty");
  });

  it("uses an explicit public org slug rather than a blank fallback", () => {
    expect(resolvePublicChatOrgSlug(" tenant-x ")).toBe("tenant-x");
  });
});

describe("public workspace-unavailable message", () => {
  it("recognizes the 404 org-lookup failure exactly as the API reports it", () => {
    // The live voice/chat routes return {"error":"Unknown business"} (404)
    // when the configured slug has no workspace row.
    expect(isPublicOrgUnavailableError("Unknown business")).toBe(true);
    expect(isPublicOrgUnavailableError("unknown business")).toBe(true);
    expect(isPublicOrgUnavailableError('{"error":"UNKNOWN BUSINESS"}')).toBe(true);
  });

  it("does not flag unrelated failures", () => {
    expect(isPublicOrgUnavailableError("Request failed")).toBe(false);
    expect(isPublicOrgUnavailableError("Voice is unavailable (503).")).toBe(false);
    expect(isPublicOrgUnavailableError(null)).toBe(false);
    expect(isPublicOrgUnavailableError(undefined)).toBe(false);
    expect(isPublicOrgUnavailableError("")).toBe(false);
  });

  it("keeps the buyer-facing message free of API jargon", () => {
    // The message shown to buyers must not leak the raw "Unknown business"
    // payload or any internal identifiers.
    expect(PUBLIC_ORG_UNAVAILABLE_MESSAGE).not.toMatch(/unknown business/i);
    expect(PUBLIC_ORG_UNAVAILABLE_MESSAGE.toLowerCase()).not.toContain("404");
    expect(PUBLIC_ORG_UNAVAILABLE_MESSAGE.length).toBeGreaterThan(20);
  });
});
