"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Mic, X } from "lucide-react";

/**
 * The full voice session panel (widget + voice loop controller + mic/audio
 * handling) loads on demand when the popover first opens — never in the
 * initial page bundle. Opening behavior and visuals are unchanged.
 */
const VoiceSessionWidget = dynamic(
  () => import("@/components/voice-session-widget").then((m) => m.VoiceSessionWidget),
  { ssr: false }
);

/**
 * Public floating Voice AI entry (landing page).
 *
 * Mirrors the public AI chatbot entry (PublicChatWidget) exactly: same
 * floating-button treatment, same popover positioning, same responsive
 * behavior. The panel reuses the existing VoiceSessionWidget unchanged, so
 * the public experience runs on the identical voice backend, provider
 * architecture, session security (orgSlug tenant resolution, binding,
 * rate limits), and mock/live honesty banner — no second voice system.
 */
export function PublicVoiceButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Open Basera voice assistant"
        className="fixed bottom-5 right-24 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-[0_18px_42px_rgba(22,59,77,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-strong focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/20 md:h-[68px] md:w-[68px]"
        /* Safe-area lift: identical to bottom-5 when the inset is 0 (desktop);
           rises above the home indicator on notched phones. */
        style={{ bottom: "max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))" }}
      >
        <Mic size={24} />
      </button>

      {isOpen && (
        <div
          className="theme-light fixed bottom-24 right-4 z-50 w-[calc(100vw-1.25rem)] max-w-[430px] sm:right-5"
          style={{ bottom: "max(6rem, calc(env(safe-area-inset-bottom) + 5rem))" }}
        >
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full border border-line bg-white p-2 text-slate shadow-[0_12px_30px_rgba(16,33,45,0.14)] transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
              aria-label="Close voice assistant"
            >
              <X size={16} />
            </button>
          </div>
          <VoiceSessionWidget />
        </div>
      )}
    </>
  );
}
