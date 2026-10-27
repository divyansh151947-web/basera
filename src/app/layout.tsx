import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import Providers from "@/components/providers";
// Vercel Web Analytics — cookie-free, privacy-friendly page-view tracking.
// The /next entry auto-tracks App Router route changes; no env vars needed
// (events appear in the Vercel dashboard once the project is deployed).
import { Analytics } from "@vercel/analytics/next";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_LOCALE,
  SITE_NAME,
  absoluteUrl,
  getSiteUrl,
} from "@/lib/site";

// Self-hosted Google Fonts via next/font (replaces the render-blocking
// `@import url('https://fonts.googleapis.com/...')` at the top of globals.css).
// Why this is faster:
//   - the browser no longer serialises HTML -> our CSS -> Google's CSS ->
//     woff2; the font CSS ships with our own stylesheet as @font-face rules
//     pointing at fingerprinted /_next/static/media files, so they load from
//     the same origin with no extra DNS/TLS handshakes
//   - `display: swap` keeps text visible immediately (no FOIT)
//   - `adjustFontFallback` emits metric-compatible local fallbacks, so the
//     swap does not shift layout (CLS)
// Weights match the previous import (Inter 400/500/600/700; Fraunces 500/600),
// so typography is visually unchanged.
//
// IMPORTANT: both families are requested as VARIABLE fonts on purpose. Asking
// for static weights (`weight: ["400","500","600","700"]`) makes next/font emit
// one file per weight — 294 KB across 6 files, ~200 KB of it fetched on the
// homepage. As variable fonts it is one file per family (~115 KB total, the
// same latin payload Google Fonts was serving before), but now same-origin and
// non-render-blocking instead of a third-party @import.
// Fraunces is variable-only w.r.t. its axes, so `axes` is legal here.
const inter = Inter({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-inter",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
  adjustFontFallback: true,
  // `preload` is left at its default. Note it is a no-op in this build:
  // Next 14.2.35 emits no `as="font"` preload links for these faces (verified
  // against the served HTML and across `.next` artifacts), so the faces are
  // discovered through our own stylesheet's @font-face rules instead of a
  // preload. That is the desired behaviour anyway: it keeps high-priority
  // fetch bandwidth free for the LCP hero image.
});

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  weight: "variable",
  display: "swap",
  variable: "--font-fraunces",
  fallback: ["ui-serif", "Georgia", "serif"],
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "business",
  keywords: [
    "real estate CRM software",
    "AI lead qualification",
    "AI property matching",
    "real estate sales platform",
    "lead follow-up automation",
    "property management software India",
    "voice AI for real estate",
    "real estate sales pipeline",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: SITE_LOCALE,
    url: "/",
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Basera — AI sales platform for real-estate teams",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "256x256" },
    ],
    apple: "/apple-touch-icon.png",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0e16",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
