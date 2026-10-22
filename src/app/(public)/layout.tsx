import Link from "next/link";
import { PublicMobileMenu } from "@/components/public/PublicMobileMenu";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0e16] text-white antialiased theme-dark">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0e16]/85 backdrop-blur-md">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-b from-[#e0b45c] to-[#8a6238] text-sm font-semibold text-[#1a1206] shadow-[0_8px_20px_rgba(216,169,78,0.28)]">
              B
            </span>
            <span className="font-display text-xl tracking-wide text-white max-[419px]:text-lg">Basera</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-7 text-[13px] font-medium text-white/65 lg:flex">
            <Link
              href="/explore"
              className="relative py-1 transition-colors duration-200 hover:text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-[#d8a94e] after:transition-transform after:duration-300 hover:after:scale-x-100"
            >
              Find a Property
            </Link>
            <Link href="/tour" className="relative py-1 transition-colors duration-200 hover:text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-[#d8a94e] after:transition-transform after:duration-300 hover:after:scale-x-100">
              3D Tour
            </Link>
            <Link href="/#ai-videos" className="relative py-1 transition-colors duration-200 hover:text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-[#d8a94e] after:transition-transform after:duration-300 hover:after:scale-x-100">
              AI Property Videos
            </Link>
          </nav>

          {/* Three public entry points, always reachable: the two buyer buttons
              render at every width — below `sm` they contract to short labels
              ("Login"/"Sign Up") and tighter padding so even 320px fits them
              next to the logo and menu (measured). The staff link moves into
              the mobile menu below `lg` so it is never hidden outright. */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link
              href="/buyer/login"
              className="inline-flex whitespace-nowrap rounded-lg border border-white/20 px-2.5 py-2 text-xs font-medium text-white/85 transition hover:border-white/45 hover:text-white sm:px-4 sm:text-[13px]"
            >
              <span className="hidden sm:inline">Buyer Login</span>
              <span className="sm:hidden">Login</span>
            </Link>
            <Link
              href="/buyer/signup"
              className="inline-flex whitespace-nowrap rounded-lg bg-white px-2.5 py-2 text-xs font-semibold text-[#0a0e16] transition hover:bg-white/90 sm:px-4 sm:text-[13px]"
            >
              <span className="hidden sm:inline">Create Buyer Account</span>
              <span className="sm:hidden">Sign Up</span>
            </Link>
            <Link
              href="/login"
              className="hidden lg:inline-flex rounded-lg border border-[#d8a94e]/40 px-3 py-2 text-[13px] font-medium text-[#ffdf9e] transition hover:border-[#d8a94e] hover:text-white xl:px-4"
            >
              Staff / Business Login
            </Link>
            <PublicMobileMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>

      <footer className="relative border-t border-white/10 bg-[#080c14]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d8a94e]/50 to-transparent" aria-hidden />
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-white/55 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-[#e0b45c] to-[#8a6238] text-sm font-semibold text-[#1a1206] shadow-[0_8px_20px_rgba(216,169,78,0.28)]">B</span>
            <div>
              <p className="font-display text-xl leading-tight text-white">Basera</p>
              <p className="mt-1 max-w-xs text-[13px] leading-6 text-white/60">AI-powered sales pipeline for premium real-estate teams.</p>
            </div>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3">
            <Link href="/explore" className="transition-colors hover:text-[#ffdf9e]">Find a Property</Link>
            <Link href="/tour" className="transition-colors hover:text-[#ffdf9e]">3D Tour</Link>
            <Link href="/#ai-videos" className="transition-colors hover:text-[#ffdf9e]">AI Property Videos</Link>
            <Link href="/buyer/login" className="transition-colors hover:text-[#ffdf9e]">Buyer Login</Link>
            <Link href="/buyer/signup" className="transition-colors hover:text-[#ffdf9e]">Create Buyer Account</Link>
            <Link href="/login" className="transition-colors hover:text-[#ffdf9e]">Staff / Business Login</Link>
          </nav>
          <p className="text-[13px] text-white/55">© {new Date().getFullYear()} Basera</p>
        </div>
      </footer>
    </div>
  );
}