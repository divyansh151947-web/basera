"use client";

// Mobile/tablet navigation for the public marketing pages.
//
// Why this exists: the public header shows the three public entry points
// (Buyer Login, Create Buyer Account, Staff / Business Login) on desktop, but
// those buttons cannot all fit next to the logo on a phone. This menu keeps
// every one of them reachable at small widths — plus the primary nav links —
// instead of silently hiding them. It renders nothing above the `lg`
// breakpoint (the desktop header takes over there).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export interface PublicNavLink {
  href: string;
  label: string;
}

const DEFAULT_LINKS: PublicNavLink[] = [
  { href: "/explore", label: "Find a Property" },
  { href: "/tour", label: "3D Tour" },
  { href: "/#ai-videos", label: "AI Property Videos" },
];

export function PublicMobileMenu({ links = DEFAULT_LINKS }: { links?: PublicNavLink[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => setOpen(false), []);

  // Close whenever the route changes (a nav link was tapped).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape and lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="public-mobile-menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 text-white/85 transition hover:border-white/45 hover:text-white"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
      </button>

      {open && (
        <div
          id="public-mobile-menu"
          className="absolute inset-x-0 top-full z-50 border-b border-white/10 bg-[#0a0e16]/97 backdrop-blur-md"
        >
          <nav aria-label="Mobile" className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 sm:px-6">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={close}
                className="rounded-lg px-3 py-2.5 text-[15px] font-medium text-white/80 transition hover:bg-white/5 hover:text-white"
              >
                {l.label}
              </Link>
            ))}

            <div className="my-2 h-px bg-white/10" role="separator" />

            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Sign in</p>
            <Link
              href="/buyer/login"
              onClick={close}
              className="rounded-lg px-3 py-2.5 text-[15px] font-medium text-white/85 transition hover:bg-white/5 hover:text-white"
            >
              Buyer Login
            </Link>
            <Link
              href="/buyer/signup"
              onClick={close}
              className="rounded-lg px-3 py-2.5 text-[15px] font-medium text-white/85 transition hover:bg-white/5 hover:text-white"
            >
              Create Buyer Account
            </Link>
            <Link
              href="/login"
              onClick={close}
              className="rounded-lg px-3 py-2.5 text-[15px] font-medium text-white/85 transition hover:bg-white/5 hover:text-white"
            >
              Staff / Business Login
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
