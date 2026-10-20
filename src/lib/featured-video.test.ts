import { describe, expect, it } from "vitest";

import {
  compareForFallback,
  hasVideo,
  pickFeaturedPropertyVideo,
  type FeaturedVideoCandidate,
} from "./featured-video";

function prop(over: Partial<FeaturedVideoCandidate> = {}): FeaturedVideoCandidate {
  return {
    id: "p-1",
    title: "Skyline Residences",
    city: "Gurugram",
    locality: "Sector 54",
    videoUrl: "/api/media/properties/org/a1.mp4",
    videoPosterUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("hasVideo", () => {
  it("accepts a non-empty video URL", () => {
    expect(hasVideo({ videoUrl: "/api/media/properties/org/a1.mp4" })).toBe(true);
  });

  it("rejects null, undefined, and blank URLs", () => {
    expect(hasVideo({ videoUrl: null })).toBe(false);
    expect(hasVideo({ videoUrl: undefined })).toBe(false);
    expect(hasVideo({ videoUrl: "" })).toBe(false);
    expect(hasVideo({ videoUrl: "   " })).toBe(false);
  });
});

describe("compareForFallback", () => {
  it("orders newest first", () => {
    const older = prop({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = prop({ id: "b", createdAt: "2026-06-01T00:00:00.000Z" });
    expect([older, newer].sort(compareForFallback).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("breaks createdAt ties by id ascending (deterministic)", () => {
    const t = "2026-01-01T00:00:00.000Z";
    const a = prop({ id: "aaa", createdAt: t });
    const b = prop({ id: "bbb", createdAt: t });
    expect([b, a].sort(compareForFallback).map((p) => p.id)).toEqual(["aaa", "bbb"]);
    expect([a, b].sort(compareForFallback).map((p) => p.id)).toEqual(["aaa", "bbb"]);
  });

  it("treats a missing/invalid createdAt as oldest", () => {
    const noDate = prop({ id: "z", createdAt: null });
    const dated = prop({ id: "a", createdAt: "2020-01-01T00:00:00.000Z" });
    expect([noDate, dated].sort(compareForFallback).map((p) => p.id)).toEqual(["a", "z"]);
  });
});

describe("pickFeaturedPropertyVideo", () => {
  it("returns null when no candidate has a video (honest empty state)", () => {
    const candidates = [prop({ videoUrl: null }), prop({ id: "p-2", videoUrl: "" })];
    expect(pickFeaturedPropertyVideo(candidates)).toBeNull();
    expect(pickFeaturedPropertyVideo([])).toBeNull();
  });

  it("ignores video-less properties even when they match the preferred city", () => {
    const noVideoInPreferredCity = prop({
      id: "no-video",
      city: "Mumbai",
      locality: "Bandra",
      videoUrl: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const withVideoElsewhere = prop({
      id: "has-video",
      city: "Pune",
      locality: "Koregaon Park",
      videoUrl: "/api/media/properties/org/b7.mp4",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const pick = pickFeaturedPropertyVideo([noVideoInPreferredCity, withVideoElsewhere], {
      city: "Mumbai",
      locality: "Bandra",
    });
    expect(pick?.id).toBe("has-video");
  });

  it("prefers the viewer's locality over city-wide and global candidates", () => {
    const localityMatch = prop({ id: "local", locality: "Sector 54", createdAt: "2026-01-01T00:00:00.000Z" });
    const cityMatch = prop({ id: "city", locality: "Sector 43", createdAt: "2026-06-01T00:00:00.000Z" });
    const globalNewest = prop({ id: "global", city: "Mumbai", locality: "Bandra", createdAt: "2026-09-01T00:00:00.000Z" });
    const pick = pickFeaturedPropertyVideo([globalNewest, cityMatch, localityMatch], {
      city: "Gurugram",
      locality: "Sector 54",
    });
    expect(pick?.id).toBe("local");
  });

  it("falls back to city when no locality candidate has a video", () => {
    const cityMatch = prop({ id: "city", locality: "Sector 43", createdAt: "2026-01-01T00:00:00.000Z" });
    const globalNewest = prop({ id: "global", city: "Mumbai", locality: "Bandra", createdAt: "2026-09-01T00:00:00.000Z" });
    const pick = pickFeaturedPropertyVideo([globalNewest, cityMatch], {
      city: "Gurugram",
      locality: "Golf Course Road",
    });
    expect(pick?.id).toBe("city");
  });

  it("matches city/locality case- and whitespace-insensitively", () => {
    const candidate = prop({ id: "c1", city: "  Gurugram ", locality: "Sector 54 " });
    const pick = pickFeaturedPropertyVideo([candidate], { city: "gurugram", locality: "sector  54" });
    expect(pick?.id).toBe("c1");
  });

  it("falls back deterministically to the newest video property with no preference", () => {
    const older = prop({ id: "old", createdAt: "2025-01-01T00:00:00.000Z" });
    const newer = prop({ id: "new", createdAt: "2026-08-01T00:00:00.000Z" });
    const pick = pickFeaturedPropertyVideo([older, newer]);
    expect(pick?.id).toBe("new");
  });

  it("is stable across repeated calls (same input order shuffled → same pick)", () => {
    const t = "2026-01-01T00:00:00.000Z";
    const a = prop({ id: "a", createdAt: t });
    const b = prop({ id: "b", createdAt: t });
    const c = prop({ id: "c", createdAt: t });
    const forward = pickFeaturedPropertyVideo([a, b, c]);
    const reversed = pickFeaturedPropertyVideo([c, b, a]);
    expect(forward?.id).toBe("a");
    expect(reversed?.id).toBe("a");
  });

  it("picks the newest within a matching city when several qualify", () => {
    const older = prop({ id: "older", city: "Mumbai", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = prop({ id: "newer", city: "Mumbai", createdAt: "2026-05-01T00:00:00.000Z" });
    expect(pickFeaturedPropertyVideo([older, newer], { city: "Mumbai" })?.id).toBe("newer");
  });

  it("does not match a partial city name (exact normalised equality only)", () => {
    // "gurugram" must not match the city "gur" or the city "new gurugram".
    const partial = prop({ id: "gur", city: "Gur", locality: "Old Town", createdAt: "2026-01-01T00:00:00.000Z" });
    const prefixed = prop({ id: "prefixed", city: "New Gurugram", locality: "Extension", createdAt: "2026-02-01T00:00:00.000Z" });
    const exact = prop({ id: "exact", city: "Gurugram", locality: "Sector 54", createdAt: "2025-01-01T00:00:00.000Z" });
    const pick = pickFeaturedPropertyVideo([partial, prefixed, exact], { city: "gurugram" });
    expect(pick?.id).toBe("exact");
  });
});
