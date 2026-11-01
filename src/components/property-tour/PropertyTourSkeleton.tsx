export function PropertyTourSkeleton() {
  return (
    <div className="h-[100svh] w-full bg-[#0a0e16] animate-pulse">
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,170,100,0.10) 0%, rgba(20,26,44,0.06) 45%, rgba(10,12,22,0.22) 100%)", mixBlendMode: "soft-light" }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 52%, rgba(8,10,18,0.42) 100%)" }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E\")" }} />
      <div className="relative h-full w-full flex items-center justify-center">
        <div className="text-center">
          <p className="font-display text-3xl tracking-[0.35em] text-white">BASERA</p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.25em] text-white/60">Lighting the villa…</p>
          <div className="mt-6 mx-auto h-px w-40 overflow-hidden bg-white/15">
            <div className="h-full w-1/3 animate-pulse bg-[#ffdf9e]" />
          </div>
        </div>
      </div>
    </div>
  );
}