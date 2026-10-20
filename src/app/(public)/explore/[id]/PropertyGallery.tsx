"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { Maximize, Minimize, ChevronLeft, ChevronRight, X } from "lucide-react";

interface PropertyGalleryProps {
  images: string[];
  propertyName: string;
  locality: string;
  city: string;
}

export function PropertyGallery({ images, propertyName, locality, city }: PropertyGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());

  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleImageError = useCallback((index: number) => {
    setImageErrors(prev => new Set(prev).add(index));
  }, []);

  const goToPrevious = useCallback(() => {
    setSelectedIndex(prev => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const goToNext = useCallback(() => {
    setSelectedIndex(prev => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFullscreen) return;
      if (e.key === "ArrowLeft") goToPrevious();
      if (e.key === "ArrowRight") goToNext();
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, goToPrevious, goToNext]);

  if (images.length === 0) {
    return (
      <div className="rounded-[1.6rem] overflow-hidden border border-white/10 bg-white/[0.04]">
        <div className="relative aspect-[16/9] min-h-[400px]">
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)",
            }}
          >
            <svg className="w-24 h-24 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[1.6rem] overflow-hidden border border-white/10 bg-white/[0.04]">
      <div className="relative aspect-[16/9] min-h-[400px]">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/5">
            <div className="w-8 h-8 border-2 border-[#d8a94e] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <Image
          src={images[selectedIndex]}
          alt={`${propertyName} — ${locality}, ${city} — Image ${selectedIndex + 1} of ${images.length}`}
          fill
          priority
          /* The gallery sits in a `max-w-5xl` shell: full width below `lg`,
             and the 1.4fr column (~58% of the shell) from `lg` up. Declaring
             that instead of `100vw` stops the browser from pulling a
             viewport-width variant for a ~580px slot. */
          sizes="(max-width: 1023px) calc(100vw - 2rem), 58vw"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isLoading ? "opacity-0" : "opacity-100"}`}
          onLoad={handleImageLoad}
          onError={() => handleImageError(selectedIndex)}
        />
        {imageErrors.has(selectedIndex) && (
          <div className="absolute inset-0 flex items-center justify-center" style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)",
          }}>
            <svg className="w-24 h-24 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/35" aria-hidden />

        {images.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/50 p-2 text-white/90 hover:bg-black/70 transition-opacity opacity-0 group-hover:opacity-100"
              aria-label="Previous image"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={goToNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/50 p-2 text-white/90 hover:bg-black/70 transition-opacity opacity-0 group-hover:opacity-100"
              aria-label="Next image"
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedIndex(idx)}
              className={`h-16 w-24 rounded overflow-hidden border-2 transition-all ${
                idx === selectedIndex
                  ? "border-[#d8a94e] opacity-100 scale-105"
                  : "border-transparent opacity-70 hover:opacity-100"
              }`}
              aria-label={`View image ${idx + 1}`}
              aria-current={idx === selectedIndex ? "true" : "false"}
            >
              <Image
                src={img}
                alt=""
                fill
                sizes="96px"
                className="h-full w-full object-cover"
                onError={() => handleImageError(idx)}
              />
            </button>
          ))}
        </div>

        <div className="absolute top-4 right-4 flex gap-2">
          <button
            onClick={() => setIsFullscreen(true)}
            className="rounded-full bg-black/50 p-2 text-white/90 hover:bg-black/70 transition"
            aria-label="View fullscreen"
          >
            <Maximize size={20} />
          </button>
        </div>

        <div className="absolute bottom-4 right-4 text-white/80 text-sm font-medium">
          {selectedIndex + 1} / {images.length}
        </div>
      </div>

      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Fullscreen image gallery">
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-6 right-6 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition"
            aria-label="Close fullscreen"
          >
            <X size={24} />
          </button>
          <button
            onClick={goToPrevious}
            className="absolute left-6 z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition hidden md:block"
            aria-label="Previous image"
          >
            <ChevronLeft size={28} />
          </button>
          <button
            onClick={goToNext}
            className="absolute right-6 z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition hidden md:block"
            aria-label="Next image"
          >
            <ChevronRight size={28} />
          </button>
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <Image
              src={images[selectedIndex]}
              alt={`${propertyName} — ${locality}, ${city} — Image ${selectedIndex + 1} of ${images.length}`}
              width={1200}
              height={800}
              className="max-w-[90vw] max-h-[90vh] object-contain"
            />
          </div>
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2 md:hidden">
            <button onClick={goToPrevious} className="rounded-full bg-white/10 p-2 text-white" aria-label="Previous">
              <ChevronLeft size={20} />
            </button>
            <button onClick={goToNext} className="rounded-full bg-white/10 p-2 text-white" aria-label="Next">
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white text-sm">
            {selectedIndex + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
}