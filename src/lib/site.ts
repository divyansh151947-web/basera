/**
 * Single source of truth for public site identity used by metadata,
 * robots, sitemap, and structured data. Presentation layer only.
 */
export const SITE_NAME = "Basera";
export const SITE_LOCALE = "en_IN";

export const DEFAULT_TITLE = "Basera | AI Sales Platform for Real Estate Teams";
export const DEFAULT_DESCRIPTION =
  "Turn more property enquiries into qualified buyers — AI-powered lead response, qualification and follow-up for Indian real-estate teams.";

/**
 * Public origin. Set NEXT_PUBLIC_SITE_URL (e.g. https://www.basera.com) in
 * production so canonical, Open Graph, and sitemap URLs resolve correctly.
 * APP_URL is the app's own configured origin and is the next best value.
 */
export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    "http://localhost:3001";
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:3001";
  }
}

export function absoluteUrl(path: string = "/"): string {
  return new URL(path, `${getSiteUrl()}/`).toString();
}
