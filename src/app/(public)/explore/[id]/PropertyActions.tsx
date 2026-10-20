"use client";

import { MessageSquare, CalendarClock, Share2 } from "lucide-react";
import Link from "next/link";
import { OPEN_CHAT_EVENT } from "@/components/public-chat-widget";

interface PropertyActionsProps {
  propertyId: string;
  projectName: string;
  locality: string;
  city: string;
  organizationName: string;
}

export function PropertyActions({ propertyId, projectName, locality, city, organizationName }: PropertyActionsProps) {
  const handleChatClick = () => {
    // Open the property-scoped widget via event first (the launcher button is
    // not mounted on every route); fall back to clicking the launcher only
    // when no mounted widget consumed the event.
    const detail = { propertyId, handled: false };
    window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail }));
    if (detail.handled) return;
    const chatBtn = document.querySelector('[aria-label="Open Basera AI chat"]') as HTMLElement;
    chatBtn?.click();
  };

  const handleShareClick = () => {
    navigator.share?.({ 
      title: projectName, 
      text: `${projectName}, ${locality}, ${city}`, 
      url: window.location.href 
    }).catch(() => {});
  };

  return (
    <div className="panel-surface p-5 sticky top-24">
      <h2 className="text-sm font-semibold text-white">Take the next step</h2>
      <p className="mt-2 text-sm text-white/65">Interested in this property? Chat with our AI assistant or schedule a site visit.</p>

      <div className="mt-4 space-y-3">
        <button
          onClick={handleChatClick}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0a0e16] transition hover:bg-white/90"
        >
          <MessageSquare size={18} /> Chat with AI Assistant
        </button>
        <Link
          href={`/?chat=property&propertyId=${propertyId}`}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-white/85 transition hover:border-white/50 hover:text-white"
        >
          <CalendarClock size={18} /> Schedule a Site Visit
        </Link>
        <button
          onClick={handleShareClick}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white/80 transition hover:bg-white/10"
        >
          <Share2 size={18} /> Share Property
        </button>
      </div>

      <div className="mt-6 pt-6 border-t border-white/10">
        <p className="text-xs text-white/60">This property is listed by <span className="font-medium text-white/70">{organizationName}</span>. All details are verified by the listing agent.</p>
      </div>
    </div>
  );
}