"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Mic, X } from "lucide-react";
import { CHAT_OPEN_CHANGE_EVENT, VOICE_OPEN_CHANGE_EVENT } from "@/components/public-chat-widget";

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
 * Mirrors the public AI chatbot entry (PublicChatWidget): same floating-button
 * treatment, same popover positioning, same responsive behavior. The panel
 * reuses the existing VoiceSessionWidget (device voice session loop, identical
 * backend, tenant resolution and mock/live honesty banner) — no second voice
 * system.
 *
 * Launchers are STACKED (voice floats above the chat bubble in one
 * right-aligned column) instead of side by side: side by side, the pair was
 * 144px+ wide and overlayed the hero CTA row and proof stats at 320-430px.
 * The two widgets also coordinate through window events so never both:
 * opening one hides/closes the other.
 */
export function PublicVoiceButton({ defaultOrgSlug }: { defaultOrgSlug?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  /** Live mirror of the chat panel's open state (see event below). */
  const [chatOpen, setChatOpen] = useState(false);

  // Follow the chat widget: open chat => fold this panel + hide this launcher.
  useEffect(() => {
    function handleChatOpen(event: Event) {
      const open = !!(event as CustomEvent<{ open?: boolean }>).detail?.open;
      setChatOpen(open);
      if (open) setIsOpen(false);
    }
    window.addEventListener(CHAT_OPEN_CHANGE_EVENT, handleChatOpen);
    return () => window.removeEventListener(CHAT_OPEN_CHANGE_EVENT, handleChatOpen);
  }, []);

  // Broadcast voice-panel state so the chat widget closes itself when this
  // panel opens (its own launcher stays visible under its panel, so only
  // this side needs the mutual close).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(VOICE_OPEN_CHANGE_EVENT, { detail: { open: isOpen } }));
  }, [isOpen]);

  const launcherHidden = chatOpen || isOpen;

  return (
    <>
      {!launcherHidden && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open Basera voice assistant"
          className="fixed right-5 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-[0_18px_42px_rgba(22,59,77,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-strong focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/20 md:h-[68px] md:w-[68px]"
          /* Stacked directly above the chat launcher. The chat bubble anchors
             at bottom 1.25rem (or the safe-area inset) and is 64px tall, so
             this one anchors 4.75rem higher — 12px of clearance on phones,
             8px where the chat bubble is 68px tall at md. */
          style={{ bottom: "calc(max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem)) + 4.75rem)" }}
        >
          <Mic size={24} />
        </button>
      )}

      {isOpen && (
        <div
          className="theme-light fixed right-4 z-50 flex max-h-[calc(100svh-6.5rem)] w-[calc(100vw-1.25rem)] max-w-[430px] flex-col sm:right-5"
          style={{ bottom: "max(6rem, calc(env(safe-area-inset-bottom) + 5rem))" }}
        >
          {/* Close control pinned outside the scrollable conversation, so it
              stays reachable at any panel height (including landscape phones
              where the inner widget scrolls internally). */}
          <div className="mb-2 flex shrink-0 justify-end">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full border border-line bg-white p-2 text-slate shadow-[0_12px_30px_rgba(16,33,45,0.14)] transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
              aria-label="Close voice assistant"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto">
            <VoiceSessionWidget defaultOrgSlug={defaultOrgSlug} />
          </div>
        </div>
      )}
    </>
  );
}
