"use client";

import { useState } from "react";
import { VideoOff } from "lucide-react";

interface PropertyVideoProps {
  url: string;
  posterUrl?: string | null;
  title: string;
}

/**
 * Buyer-facing property video. Accessible native HTML5 player with standard
 * controls (play/pause/seek/mute/fullscreen). No autoplay, no autoplay-with-
 * sound, `preload="metadata"` so the full video is not downloaded up front.
 * If the source cannot load, a graceful, non-broken placeholder is shown.
 */
export function PropertyVideo({ url, posterUrl, title }: PropertyVideoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-8 text-center text-white/65"
        role="status"
      >
        <VideoOff size={40} className="mx-auto text-white/25" />
        <p className="mt-3 text-sm">The property video can’t be played right now.</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm font-semibold text-[#ffdf9e] hover:underline"
        >
          Open video in a new tab
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[1.6rem] overflow-hidden border border-white/10 bg-white/[0.04]">
      <video
        className="aspect-video w-full bg-black"
        controls
        playsInline
        preload="metadata"
        poster={posterUrl ?? undefined}
        aria-label={`${title} — property video`}
        onError={() => setFailed(true)}
      >
        <source src={url} type="video/mp4" />
        Your browser does not support the video tag.
      </video>
    </div>
  );
}