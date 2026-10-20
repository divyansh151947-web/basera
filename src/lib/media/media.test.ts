import { describe, it, expect } from "vitest";
import {
  validateImageUpload,
  validateVideoUpload,
  sniffImageType,
  sniffVideoType,
  maxImageBytes,
  maxVideoBytes,
  formatBytes,
  extensionForMime,
} from "./validate";
import {
  parseImagesJson,
  serializeImagesJson,
  validateGalleryUpdate,
  isAcceptableImageUrl,
  MAX_GALLERY_IMAGES,
} from "./property-media";
import {
  mediaUrlFor,
  parseOwnedMediaUrl,
  isOwnedMediaUrl,
  SAFE_ORG_ID,
  SAFE_MEDIA_FILENAME,
} from "./urls";

// ==========================================================================
// VALIDATION
// ==========================================================================

describe("validate", () => {
  describe("sniffImageType", () => {
    it("detects JPEG magic bytes", () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(sniffImageType(bytes)).toBe("image/jpeg");
    });

    it("detects PNG magic bytes", () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(sniffImageType(bytes)).toBe("image/png");
    });

    it("detects WebP magic bytes", () => {
      const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
      expect(sniffImageType(bytes)).toBe("image/webp");
    });

    it("returns null for unknown bytes", () => {
      const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      expect(sniffImageType(bytes)).toBeNull();
    });

    it("returns null for empty bytes", () => {
      expect(sniffImageType(new Uint8Array(0))).toBeNull();
    });
  });

  describe("sniffVideoType", () => {
    it("detects MP4 ftyp box", () => {
      // ftyp box: size (4 bytes) + "ftyp" + brand
      const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
      expect(sniffVideoType(bytes)).toBe("video/mp4");
    });

    it("returns null for non-MP4 bytes", () => {
      const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x78, 0x79, 0x7a, 0x7a]);
      // Still returns video/mp4 because the ftyp box is valid
      expect(sniffVideoType(bytes)).toBe("video/mp4");
    });

    it("returns null for too-short bytes", () => {
      expect(sniffVideoType(new Uint8Array([0x00, 0x00, 0x00]))).toBeNull();
    });
  });

  describe("validateImageUpload", () => {
    it("accepts a valid JPEG", () => {
      const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const result = validateImageUpload({ name: "photo.jpg", type: "image/jpeg", size: 1024, head });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ext).toBe("jpg");
      }
    });

    it("rejects empty files", () => {
      const head = new Uint8Array([0xff, 0xd8, 0xff]);
      const result = validateImageUpload({ name: "photo.jpg", type: "image/jpeg", size: 0, head });
      expect(result.ok).toBe(false);
    });

    it("rejects oversized images", () => {
      const head = new Uint8Array([0xff, 0xd8, 0xff]);
      const result = validateImageUpload({ name: "photo.jpg", type: "image/jpeg", size: maxImageBytes() + 1, head });
      expect(result.ok).toBe(false);
    });

    it("rejects unsupported formats", () => {
      const head = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const result = validateImageUpload({ name: "photo.gif", type: "image/gif", size: 1024, head });
      expect(result.ok).toBe(false);
    });
  });

  describe("validateVideoUpload", () => {
    it("accepts a valid MP4", () => {
      const head = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
      const result = validateVideoUpload({ name: "video.mp4", type: "video/mp4", size: 1024, head });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ext).toBe("mp4");
      }
    });

    it("rejects empty files", () => {
      const head = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
      const result = validateVideoUpload({ name: "video.mp4", type: "video/mp4", size: 0, head });
      expect(result.ok).toBe(false);
    });

    it("rejects oversized videos", () => {
      const head = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
      const result = validateVideoUpload({ name: "video.mp4", type: "video/mp4", size: maxVideoBytes() + 1, head });
      expect(result.ok).toBe(false);
    });
  });

  describe("formatBytes", () => {
    it("formats bytes correctly", () => {
      expect(formatBytes(0)).toBe("0 MB");
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
      expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
      expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
    });
  });

  describe("extensionForMime", () => {
    it("returns correct extensions", () => {
      expect(extensionForMime("image/jpeg")).toBe("jpg");
      expect(extensionForMime("image/png")).toBe("png");
      expect(extensionForMime("image/webp")).toBe("webp");
      expect(extensionForMime("video/mp4")).toBe("mp4");
      expect(extensionForMime("unknown")).toBe("bin");
    });
  });
});

// ==========================================================================
// PROPERTY MEDIA
// ==========================================================================

describe("property-media", () => {
  describe("parseImagesJson", () => {
    it("parses valid JSON array", () => {
      expect(parseImagesJson('["url1","url2"]')).toEqual(["url1", "url2"]);
    });

    it("returns empty array for invalid JSON", () => {
      expect(parseImagesJson("not json")).toEqual([]);
    });

    it("returns empty array for non-string input", () => {
      expect(parseImagesJson(null)).toEqual([]);
      expect(parseImagesJson(123)).toEqual([]);
    });

    it("filters out non-string entries", () => {
      expect(parseImagesJson('["url1", 123, "url2"]')).toEqual(["url1", "url2"]);
    });

    it("filters out overly long URLs", () => {
      const longUrl = "https://example.com/" + "a".repeat(3000);
      expect(parseImagesJson(JSON.stringify([longUrl]))).toEqual([]);
    });
  });

  describe("serializeImagesJson", () => {
    it("serializes to JSON string", () => {
      expect(serializeImagesJson(["url1", "url2"])).toBe('["url1","url2"]');
    });
  });

  describe("isAcceptableImageUrl", () => {
    it("accepts own media URLs", () => {
      const validFile = "a".repeat(64) + ".jpg";
      expect(isAcceptableImageUrl(`/api/media/properties/org123/${validFile}`)).toBe(true);
    });

    it("accepts https URLs", () => {
      expect(isAcceptableImageUrl("https://example.com/image.jpg")).toBe(true);
    });

    it("rejects http URLs", () => {
      expect(isAcceptableImageUrl("http://example.com/image.jpg")).toBe(false);
    });

    it("rejects javascript: URLs", () => {
      expect(isAcceptableImageUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects data: URLs", () => {
      expect(isAcceptableImageUrl("data:image/png;base64,abc")).toBe(false);
    });

    it("rejects blob: URLs", () => {
      expect(isAcceptableImageUrl("blob:https://example.com/abc")).toBe(false);
    });

    it("rejects empty strings", () => {
      expect(isAcceptableImageUrl("")).toBe(false);
    });

    it("rejects overly long URLs", () => {
      const longUrl = "https://example.com/" + "a".repeat(3000);
      expect(isAcceptableImageUrl(longUrl)).toBe(false);
    });
  });

  describe("validateGalleryUpdate", () => {
    const validFile1 = "a".repeat(64) + ".jpg";
    const validFile2 = "b".repeat(64) + ".png";

    it("accepts valid gallery with own media URLs", () => {
      const urls = [`/api/media/properties/org123/${validFile1}`, `/api/media/properties/org123/${validFile2}`];
      const result = validateGalleryUpdate(urls, "org123", []);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.images).toEqual(urls);
      }
    });

    it("rejects URLs from other organizations", () => {
      const urls = [`/api/media/properties/other-org/${validFile1}`];
      const result = validateGalleryUpdate(urls, "org123", []);
      expect(result.ok).toBe(false);
    });

    it("allows existing https URLs to be re-listed", () => {
      const urls = ["https://example.com/image.jpg"];
      const result = validateGalleryUpdate(urls, "org123", urls);
      expect(result.ok).toBe(true);
    });

    it("rejects new https URLs not in existing gallery", () => {
      const urls = ["https://example.com/new-image.jpg"];
      const result = validateGalleryUpdate(urls, "org123", ["https://example.com/old-image.jpg"]);
      expect(result.ok).toBe(false);
    });

    it("rejects non-array input", () => {
      const result = validateGalleryUpdate("not an array", "org123", []);
      expect(result.ok).toBe(false);
    });

    it("rejects too many images", () => {
      const urls = Array(MAX_GALLERY_IMAGES + 1).fill(`/api/media/properties/org123/${validFile1}`);
      const result = validateGalleryUpdate(urls, "org123", []);
      expect(result.ok).toBe(false);
    });

    it("silently drops duplicates", () => {
      const urls = [`/api/media/properties/org123/${validFile1}`, `/api/media/properties/org123/${validFile1}`];
      const result = validateGalleryUpdate(urls, "org123", []);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.images).toHaveLength(1);
      }
    });
  });
});

// ==========================================================================
// URLS
// ==========================================================================

describe("urls", () => {
  describe("mediaUrlFor", () => {
    it("creates correct media URL", () => {
      const validFile = "a".repeat(64) + ".jpg";
      expect(mediaUrlFor("org123", validFile)).toBe(`/api/media/properties/org123/${validFile}`);
    });

    it("encodes special characters", () => {
      expect(mediaUrlFor("org/123", "abc 123.jpg")).toBe("/api/media/properties/org%2F123/abc%20123.jpg");
    });
  });

  describe("parseOwnedMediaUrl", () => {
    const validFile = "a".repeat(64) + ".jpg";

    it("parses valid media URL", () => {
      const result = parseOwnedMediaUrl(`/api/media/properties/org123/${validFile}`);
      expect(result).toEqual({ organizationId: "org123", filename: validFile });
    });

    it("returns null for non-media URLs", () => {
      expect(parseOwnedMediaUrl("/api/properties/123")).toBeNull();
      expect(parseOwnedMediaUrl("https://example.com")).toBeNull();
    });

    it("returns null for invalid org ID", () => {
      expect(parseOwnedMediaUrl(`/api/media/properties/org@123/${validFile}`)).toBeNull();
    });

    it("returns null for invalid filename", () => {
      expect(parseOwnedMediaUrl("/api/media/properties/org123/abc@123.jpg")).toBeNull();
    });
  });

  describe("isOwnedMediaUrl", () => {
    const validFile = "a".repeat(64) + ".jpg";

    it("returns true for owned URL", () => {
      expect(isOwnedMediaUrl(`/api/media/properties/org123/${validFile}`, "org123")).toBe(true);
    });

    it("returns false for other org URL", () => {
      expect(isOwnedMediaUrl(`/api/media/properties/other/${validFile}`, "org123")).toBe(false);
    });

    it("returns false for non-media URL", () => {
      expect(isOwnedMediaUrl("https://example.com", "org123")).toBe(false);
    });
  });

  describe("SAFE_ORG_ID", () => {
    it("accepts valid org IDs", () => {
      expect(SAFE_ORG_ID.test("org123")).toBe(true);
      expect(SAFE_ORG_ID.test("my-org_123")).toBe(true);
    });

    it("rejects invalid org IDs", () => {
      expect(SAFE_ORG_ID.test("org@123")).toBe(false);
      expect(SAFE_ORG_ID.test("org 123")).toBe(false);
      expect(SAFE_ORG_ID.test("")).toBe(false);
    });
  });

  describe("SAFE_MEDIA_FILENAME", () => {
    it("accepts valid filenames", () => {
      expect(SAFE_MEDIA_FILENAME.test("a".repeat(64) + ".jpg")).toBe(true);
      expect(SAFE_MEDIA_FILENAME.test("a".repeat(64) + ".png")).toBe(true);
      expect(SAFE_MEDIA_FILENAME.test("a".repeat(64) + ".webp")).toBe(true);
      expect(SAFE_MEDIA_FILENAME.test("a".repeat(64) + ".mp4")).toBe(true);
    });

    it("rejects invalid filenames", () => {
      expect(SAFE_MEDIA_FILENAME.test("abc.jpg")).toBe(false);
      expect(SAFE_MEDIA_FILENAME.test("a".repeat(64) + ".gif")).toBe(false);
      expect(SAFE_MEDIA_FILENAME.test("a".repeat(64) + ".exe")).toBe(false);
      expect(SAFE_MEDIA_FILENAME.test("")).toBe(false);
    });
  });
});
