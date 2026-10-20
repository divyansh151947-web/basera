import type { Metadata } from "next";
import Link from "next/link";
import { VoiceSessionWidget } from "@/components/voice-session-widget";

export const metadata: Metadata = {
  title: "Talk to Basera AI",
  description:
    "Speak or type to Basera's voice sales assistant — the same AI that qualifies buyers, matches properties, and answers from your inventory.",
  alternates: { canonical: "/voice" },
};

/**
 * Public voice demo page (Voice AI Phase 1 foundation).
 *
 * Additive only: uses the existing public-page visual language and touches
 * no existing page, component, or navigation. The mock banner inside the
 * widget states exactly what is and isn't real in this phase.
 */
export default function VoicePage() {
  return (
    <div className="theme-dark min-h-screen w-full bg-[#0a0e16] text-white">
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-10">
      <div>
        <Link href="/" className="text-sm font-semibold text-brand hover:text-brand-strong">
          ← Back to Basera
        </Link>
        <h1 className="mt-3 font-display text-3xl text-ink">Talk to Basera AI</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate">
          Voice sales assistant foundation. Speak or type — the same Basera intelligence that powers website
          chat answers, on the same leads and conversations.
        </p>
      </div>
      <VoiceSessionWidget />
    </div>
    </div>
  );
}
