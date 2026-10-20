"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { PriceHistoryChart as PriceHistoryChartType } from "./PriceHistoryChart";

type Props = {
  property: Parameters<typeof PriceHistoryChartType>[0]["property"];
};

const PriceHistoryChart = dynamic(
  () => import("./PriceHistoryChart").then((mod) => mod.PriceHistoryChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

/**
 * recharts (~108 KB) was loaded as an eager script in the property-detail
 * HTML, so it downloaded on the critical path even though the chart sits
 * far below the fold. This defers both the download and hydration until the
 * section approaches the viewport.
 */
export default function LazyPriceHistoryChart({ property }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px", threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="min-h-[28rem]">
      {visible ? <PriceHistoryChart property={property} /> : <ChartSkeleton />}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="panel-surface p-5 space-y-6" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="h-5 w-36 sm:w-56 rounded bg-white/10" />
        <div className="h-4 w-24 rounded bg-white/5" />
      </div>
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        <div className="h-8 flex-1 min-w-[4.5rem] rounded bg-white/5" />
        <div className="h-8 flex-1 min-w-[4.5rem] rounded bg-white/5" />
        <div className="h-8 flex-1 min-w-[4.5rem] rounded bg-white/5" />
      </div>
      <div className="h-64 rounded-xl bg-white/5" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-xl bg-white/5" />
        <div className="h-24 rounded-xl bg-white/5" />
        <div className="h-24 rounded-xl bg-white/5" />
      </div>
    </div>
  );
}
