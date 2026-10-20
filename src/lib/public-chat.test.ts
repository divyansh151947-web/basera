import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLIC_CHAT_ORG_SLUG, resolvePublicChatOrgSlug } from "@/lib/public-chat";

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
