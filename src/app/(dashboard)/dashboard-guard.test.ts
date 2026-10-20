import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Sessionless dashboard renders must redirect to /login instead of throwing
 * TypeError on `session!.user` (observed live: revoked-token window rendered
 * the dashboard page with a null session and crashed while the layout
 * redirect won the response). Static guard-presence test: importing .tsx
 * pages under vitest's node env is unsupported (jsx: preserve), so the
 * behavior itself is proven by the live-auth probe (revoked cookie on
 * /dashboard -> 307 /login).
 */
describe("dashboard session guards", () => {
  it("every session-reading (dashboard) page guards a null session", () => {
    const dir = __dirname;
    const pages = [
      "dashboard/page.tsx",
      "team/page.tsx",
      "appointments/page.tsx",
      "conversations/page.tsx",
      "conversations/[id]/page.tsx",
      "recovery/page.tsx",
      "leads/page.tsx",
      "leads/[id]/page.tsx",
      "properties/page.tsx",
      "properties/[id]/page.tsx",
    ];
    for (const rel of pages) {
      const src = fs.readFileSync(path.join(dir, rel), "utf8");
      expect(src, rel).toContain("getCurrentSession()");
      expect(src, rel).toContain('if (!session?.user) redirect("/login")');
      expect(src, rel).not.toContain("session!.user");
    }
  });
});
