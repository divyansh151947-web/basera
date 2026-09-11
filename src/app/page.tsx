import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-paper">
      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="font-display text-2xl text-brand">Basera</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-ink">Sign in</Link>
          <Link href="/signup" className="rounded-md bg-brand text-white px-4 py-2 font-medium">Start free trial</Link>
        </nav>
      </header>
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-20 text-center">
        <h1 className="font-display text-4xl md:text-5xl text-ink leading-tight">
          Turn more property enquiries into qualified buyers.
        </h1>
        <p className="mt-5 text-lg text-slate2 max-w-2xl mx-auto">
          AI-powered lead response, qualification, and follow-up for Indian real-estate sales teams — built to replace missed enquiries and manual spreadsheets, not just add a chatbot.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className="rounded-md bg-brand text-white px-6 py-3 font-medium">Start your 14-day trial</Link>
          <Link href="/login" className="rounded-md border border-line px-6 py-3 font-medium text-ink">Sign in</Link>
        </div>
        <p className="mt-4 text-xs text-slate2">Full landing page with feature breakdown and pricing coming next revision.</p>
      </section>
    </main>
  );
}
