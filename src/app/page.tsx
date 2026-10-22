import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { cookies } from "next/headers";
import { ArrowRight, MessageSquareText, Building2, Workflow, ShieldCheck, Sparkles, CheckCircle2, TrendingUp, MapPin, CalendarCheck2, Play, Home as HomeIcon, Map as MapIcon, BarChart3 } from "lucide-react";
import { PublicChatWidget } from "@/components/public-chat-widget";
import { PublicVoiceButton } from "@/components/public-voice-button";
import { AIVideoShowcase } from "@/components/public/AIVideoShowcase";
import { PublicMobileMenu } from "@/components/public/PublicMobileMenu";
import { Reveal } from "@/components/reveal";
import LazySection from "@/components/public/LazySection";
import { DEFAULT_DESCRIPTION, absoluteUrl } from "@/lib/site";
import { pickFeaturedPropertyVideo } from "@/lib/featured-video";
import type { ShowcaseProperty } from "@/components/public/AIVideoShowcase";
import { PREF_CITY_COOKIE, PREF_LOCALITY_COOKIE } from "@/lib/location-preference";
import { listPublicVideoProperties } from "@/lib/data/properties";

// Skeleton for 3D tour loading state
function PropertyTourSkeleton() {
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

// Skeleton for the scroll-driven journey section (matches its 340vh scroll height)
function JourneySectionSkeleton() {
  return <div className="h-[340vh] w-full bg-[#0a0e16]" />;
}

// Lazy-load heavy 3D and scroll components (below the fold)
const PropertyTour = dynamic(() => import("@/components/property-tour/PropertyTour").then((mod) => mod.PropertyTour), {
  ssr: false,
  loading: () => <PropertyTourSkeleton />,
});
const JourneySection = dynamic(() => import("@/components/property-tour/JourneySection").then((mod) => mod.JourneySection), {
  ssr: false,
  loading: () => <JourneySectionSkeleton />,
});

const JOURNEY_TABS = [
	{ label: "Property", sub: "Experience in 3D", href: "#tour-experience", icon: HomeIcon },
	{ label: "Building", sub: "Design & quality", href: "#portfolio", icon: Building2 },
	{ label: "City", sub: "Location insights", href: "#platform", icon: MapIcon },
	{ label: "Data", sub: "Market trends", href: "#capabilities", icon: BarChart3 },
	{ label: "AI", sub: "Smart suggestions", href: "#demo", icon: Sparkles },
	{ label: "Revenue", sub: "Better returns", href: "#pricing", icon: TrendingUp },
];

const FEATURES = [
	{
		title: "AI lead qualification",
		description:
			"Reads buyer intent, budget, location, and timeline from real conversations — including short replies and Hinglish.",
		icon: MessageSquareText,
	},
	{
		title: "AI property matching",
		description:
			"Recommends only listings that exist in your inventory, with real prices and availability. Nothing is invented.",
		icon: Building2,
	},
	{
		title: "Lead management",
		description:
			"Every enquiry gets a score, an owner, and a stage — so nothing sits unanswered in a spreadsheet or a personal inbox.",
		icon: TrendingUp,
	},
	{
		title: "Automated follow-up",
		description:
			"Scheduled follow-ups and recovery prompts keep warm buyers moving when your team is on site visits.",
		icon: Workflow,
	},
	{
		title: "Voice AI",
		description:
			"Answer and qualify buyers by voice or text with the same assistant, on the same leads and conversation history.",
		icon: Sparkles,
	},
	{
		title: "Conversation history",
		description:
			"Website chat, WhatsApp, and agent replies in one timeline, so any team member can pick up mid-conversation.",
		icon: CalendarCheck2,
	},
];

const STEPS = [
	{
		label: "01",
		title: "Capture enquiry",
		text: "Receive buyer conversations from the website, calls, and CRM touchpoints.",
		icon: MessageSquareText,
	},
	{
		label: "02",
		title: "Qualify with AI",
		text: "Basera understands budget, location, BHK, intent, and buying context in real time.",
		icon: Sparkles,
	},
	{
		label: "03",
		title: "Convert faster",
		text: "Match the right properties, share the most relevant options, and route hot leads to sales.",
		icon: TrendingUp,
	},
];

const PROPERTY_SHOWCASE = [
	{
		name: "Aurum Heights",
		location: "Gurugram, Sector 82",
		price: "₹1.35 Cr",
		meta: "3 BHK · Ready to move",
		image:
			"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
	},
	{
		name: "Skyline Crest",
		location: "Dwarka Expressway",
		price: "₹1.82 Cr",
		meta: "4 BHK · Luxury living",
		image:
			"https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
	},
	{
		name: "Harbor Point",
		location: "Noida Extension",
		price: "₹95 L",
		meta: "2 BHK · Smart value",
		image:
			"https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80",
	},
];

/**
 * Public homepage: one continuous cinematic world.
 * PropertyTour (realtime golden-hour villa) → JourneySection (scroll-driven
 * property→building→city→revenue story, same scene builders, same grade) →
 * platform sections in the same dark cinematic theme. All product copy,
 * anchors, and widgets below are preserved; only the visual shell changed.
 */
export default async function Home({
  searchParams,
}: {
	searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	// Property-driven video showcase: pick which published property's
	// walkthrough to feature. Priority: ?locality= / ?city= query params (used
	// by links and tests), then the visitor's first-party preference cookies
	// set by the explore city filter and property detail pages, then a
	// deterministic newest-first fallback. See src/lib/featured-video.ts.
	const params = (await searchParams) ?? {};
	const queryCity = typeof params.city === "string" && params.city !== "All" ? params.city : undefined;
	const queryLocality = typeof params.locality === "string" && params.locality !== "All" ? params.locality : undefined;
	let cookieCity: string | undefined;
	let cookieLocality: string | undefined;
	try {
		const store = await cookies();
		cookieCity = store.get(PREF_CITY_COOKIE)?.value || undefined;
		cookieLocality = store.get(PREF_LOCALITY_COOKIE)?.value || undefined;
	} catch {
		// No cookie store available (e.g. during static prerender) — the
		// deterministic fallback still picks a real published video.
	}
	let featuredVideo: ShowcaseProperty | null = null;
	try {
		const videoProperties = await listPublicVideoProperties();
		const picked = pickFeaturedPropertyVideo(videoProperties, {
			city: queryCity ?? cookieCity,
			locality: queryLocality ?? cookieLocality,
		});
		// The selector only returns properties with a non-empty videoUrl;
		// narrow it for the player prop.
		featuredVideo = picked && picked.videoUrl ? { ...picked, videoUrl: picked.videoUrl } : null;
	} catch {
		// Rendering the homepage must never fail because the showcase query
		// did — the rest of the page stands on its own.
		featuredVideo = null;
	}
	return (
		<>
			<div className="min-h-screen bg-[#0a0e16] text-white antialiased">
			<header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0e16]/85 backdrop-blur-md">
				<div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
					<Link href="/" className="flex items-center gap-2.5">
						<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-b from-[#e0b45c] to-[#8a6238] text-sm font-semibold text-[#1a1206] shadow-[0_8px_20px_rgba(216,169,78,0.28)]">
							B
						</span>
						<span className="font-display text-xl tracking-wide text-white">Basera</span>
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
						<Link href="#ai-videos" className="relative py-1 transition-colors duration-200 hover:text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-[#d8a94e] after:transition-transform after:duration-300 hover:after:scale-x-100">
							AI Property Videos
						</Link>
					</nav>

					{/* Three public entry points, always reachable: buyer links
					    shrink to short labels on narrow phones; the staff link
					    lives in the mobile menu below `lg`. */}
					<div className="flex items-center gap-2 sm:gap-3">
						<Link href="/buyer/login" className="hidden min-[420px]:inline-flex rounded-lg border border-white/20 px-3 py-2 text-[13px] font-medium text-white/85 transition hover:border-white/45 hover:text-white sm:px-4">
							<span className="hidden sm:inline">Buyer Login</span>
							<span className="sm:hidden">Login</span>
						</Link>
						<Link href="/buyer/signup" className="hidden min-[420px]:inline-flex rounded-lg bg-white px-3 py-2 text-[13px] font-semibold text-[#0a0e16] transition hover:bg-white/90 sm:px-4">
							<span className="hidden sm:inline">Create Buyer Account</span>
							<span className="sm:hidden">Sign Up</span>
						</Link>
						<Link href="/login" className="hidden lg:inline-flex rounded-lg border border-[#d8a94e]/40 px-3 py-2 text-[13px] font-medium text-[#ffdf9e] transition hover:border-[#d8a94e] hover:text-white xl:px-4">
							Staff / Business Login
						</Link>
						<PublicMobileMenu />
					</div>
				</div>
			</header>

			<main>
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify({
							"@context": "https://schema.org",
							"@graph": [
								{
									"@type": "Organization",
									"@id": `${absoluteUrl("/")}#organization`,
									name: "Basera",
									url: absoluteUrl("/"),
									logo: absoluteUrl("/icon.svg"),
									description: DEFAULT_DESCRIPTION,
								},
								{
									"@type": "WebSite",
									"@id": `${absoluteUrl("/")}#website`,
									name: "Basera",
									url: absoluteUrl("/"),
									inLanguage: "en-IN",
									publisher: { "@id": `${absoluteUrl("/")}#organization` },
								},
								{
									"@type": "SoftwareApplication",
									name: "Basera",
									url: absoluteUrl("/"),
									applicationCategory: "BusinessApplication",
									operatingSystem: "Web",
									inLanguage: "en-IN",
									description: DEFAULT_DESCRIPTION,
									author: { "@id": `${absoluteUrl("/")}#organization` },
									featureList:
										"AI lead qualification, AI property matching, lead management, automated follow-up, voice AI, sales pipeline, conversation history, appointment scheduling",
								},
							],
						}),
					}}
				/>
			<section aria-label="Basera cinematic hero" className="relative flex min-h-[100svh] w-full items-center overflow-hidden bg-[#0a0e16]">
				<div className="absolute inset-0 overflow-hidden">
					<Image
						src="/hero-villa.jpg"
						alt="Modern luxury villa at golden hour, shown in Basera's live 3D property tour"
						fill
						priority
						sizes="100vw"
						className="hero-kenburns h-full w-full object-cover object-center"
						// 75 is next/image's default and the sweet spot for this hero:
						// measured against /_next/image, the optimised w=1200 variant
						// is 249 KB at q=85 vs 188 KB at q=75. The image sits under
						// three dark gradient overlays (see below), so the extra 61 KB
						// buys no visible detail — but it does compete for bandwidth
						// with the LCP image itself, whose download was measured at
						// 3.1 s on slow-4G because of that contention.
						quality={75}
					/>
				</div>
				<div className="absolute inset-0 bg-gradient-to-r from-[#060a12]/85 via-[#060a12]/45 to-[#060a12]/10" aria-hidden />
				<div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#0a0e16] to-transparent" aria-hidden />
				<div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#0a0e16]/70 to-transparent" aria-hidden />

				<div className="relative mx-auto w-full max-w-6xl px-4 pb-32 pt-20 sm:px-6 md:pb-44 md:pt-24 lg:px-8">
					<div className="max-w-2xl">
						<p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/65">
							<span className="hidden h-px w-8 bg-[#d8a94e]/70 sm:block" aria-hidden />
							AI-powered real-estate sales platform
						</p>
						<h1 className="mt-5 font-display text-[clamp(2.8rem,7vw,5.2rem)] leading-[1.02] text-white">
							Turn property enquiries<br />into site visits.
						</h1>
						<p className="mt-5 max-w-md text-base leading-7 text-white/70 sm:text-lg">
							Basera qualifies buyers with AI, matches them to your inventory, and keeps every follow-up on schedule — one pipeline for your whole sales team.
						</p>
						<div className="mt-8 flex flex-col gap-3 sm:flex-row">
							<Link href="/explore" className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-[#0a0e16] shadow-[0_16px_36px_rgba(0,0,0,0.35)] transition hover:bg-white/90">
								Find Properties
								<ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
							</Link>
							<Link href="#demo" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/[0.06] px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:border-white/50 hover:bg-white/10">
								<Play size={15} /> See live demo
							</Link>
						</div>
						{/* Three proof-point stats. Below `sm` the three columns plus
						    dividers cannot fit without clipping the long single-word
						    labels ("QUALIFICATION", "PROPERTY TOURS"), so on phones the
						    columns shrink + wrap and the decorative dividers hide.
						    Desktop (sm+) is visually unchanged. */}
						<dl className="mt-10 flex max-w-md flex-wrap items-stretch gap-x-6 gap-y-4 text-white sm:gap-x-8">
							<div className="min-w-[7rem] flex-1">
								<dt className="sr-only">AI lead qualification</dt>
								<dd className="font-display text-2xl">AI</dd>
								<dd className="mt-1 text-xs uppercase tracking-[0.14em] text-white/60">Lead qualification</dd>
							</div>
							<div className="hidden w-px bg-white/15 sm:block" aria-hidden />
							<div className="min-w-[7rem] flex-1">
								<dt className="sr-only">Interactive 3D property tours</dt>
								<dd className="font-display text-2xl">Live 3D</dd>
								<dd className="mt-1 text-xs uppercase tracking-[0.14em] text-white/60">Property tours</dd>
							</div>
							<div className="hidden w-px bg-white/15 sm:block" aria-hidden />
							<div className="min-w-[7rem] flex-1">
								<dt className="sr-only">Automated 24/7 follow-up</dt>
								<dd className="font-display text-2xl">24/7</dd>
								<dd className="mt-1 text-xs uppercase tracking-[0.14em] text-white/60">Follow-up</dd>
							</div>
						</dl>
					</div>
				</div>

				<nav aria-label="Experience journey" className="absolute inset-x-0 bottom-0 hidden justify-center px-4 pb-6 md:flex">
					<div className="flex w-full max-w-5xl items-stretch justify-between gap-1 rounded-2xl border border-white/15 bg-black/50 px-2 py-2 backdrop-blur-md">
						{JOURNEY_TABS.map(({ label, sub, href, icon: Icon }) => (
							<Link key={label} href={href} className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center transition-colors duration-200 hover:bg-white/[0.09]">
								<Icon size={17} className="text-white/65 transition-colors group-hover:text-[#ffdf9e]" />
								<span className="text-xs font-semibold text-white">{label}</span>
								<span className="hidden text-[10px] text-white/60 transition-colors group-hover:text-white/70 lg:block">{sub}</span>
							</Link>
						))}
					</div>
				</nav>

				<div className="absolute bottom-6 left-4 hidden items-center gap-2 text-white/60 sm:left-6 md:flex" aria-hidden>
					<span className="block h-8 w-px overflow-hidden bg-white/20">
						<span className="scroll-cue-line block h-full w-px bg-[#ffdf9e]" />
					</span>
					<span className="text-[10px] font-semibold uppercase tracking-[0.22em]">Scroll to explore</span>
				</div>
			</section>

			{/* three.js (@react-three/fiber) is ~190 KB across two chunks and was
			    being fetched right after hydration, and its ~1.3s parse ran as a
			    single main-thread task exactly when the LCP hero image finished
			    downloading — holding the image's paint and costing ~0.6-1.2s of
			    LCP on slow 4G without changing the image's download time at all.
			    LazySection therefore needs BOTH gates here: `rootMargin` defers
			    the mount until the section nears the viewport, and `waitForLoad`
			    keeps the parse off the paint-critical window. A plain rootMargin
			    was not enough — this section starts only ~one viewport down, so a
			    generous margin fired immediately after hydration. `waitForLoad`
			    must not break the E2E canvas check (it asserts a canvas on "/"
			    without scrolling): Playwright navigates with waitUntil:"load",
			    so `load` is already complete by the time hydration runs there. */}
			<LazySection
				rootMargin="600px 0px"
				waitForLoad
				fallback={
					<>
						<section id="tour-experience" aria-label="Interactive 3D property experience" className="relative scroll-mt-20 bg-[#0a0e16]">
							<PropertyTourSkeleton />
						</section>
						<JourneySectionSkeleton />
					</>
				}
			>
				<section id="tour-experience" aria-label="Interactive 3D property experience" className="relative scroll-mt-20 bg-[#0a0e16]">
					<PropertyTour headingLevel="h2" />
				</section>

				<JourneySection />
			</LazySection>

			<AIVideoShowcase property={featuredVideo} />

			<div className="h-px bg-gradient-to-r from-transparent via-[#d8a94e]/40 to-transparent" aria-hidden />

			<section id="platform" className="relative mx-auto max-w-6xl scroll-mt-20 px-4 py-8 sm:px-6 lg:px-8 lg:py-16">
				<div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(216,169,78,0.08), transparent 70%)" }} aria-hidden />
				<Reveal className="relative">
					<div className="mx-auto max-w-2xl text-center">
						<span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Built for real-estate teams</span>
						<h2 className="mt-5 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">A modern operating layer for every enquiry.</h2>
					</div>
				</Reveal>

				<Reveal delayMs={120} className="relative mt-10 grid gap-5 md:grid-cols-3">
					{FEATURES.map(({ title, description, icon: Icon }) => (
						<div key={title} className="group rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_38px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#d8a94e]/30 hover:shadow-[0_26px_54px_rgba(0,0,0,0.45)]">
							<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#d8a94e]/15 text-[#ffdf9e]">
								<Icon size={22} />
							</div>
							<h3 className="mt-5 text-xl font-semibold text-white">{title}</h3>
							<p className="mt-3 text-sm leading-7 text-white/65">{description}</p>
						</div>
					))}
				</Reveal>
			</section>

			<section id="workflow" className="relative scroll-mt-20 overflow-hidden border-y border-white/10 bg-[#0d1322]">
				<div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 55% 45% at 50% 0%, rgba(216,169,78,0.07), transparent 70%)" }} aria-hidden />
				<div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
					<Reveal className="mx-auto max-w-3xl text-center">
						<span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">
							How Basera works
						</span>
						<h2 className="mt-5 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.05] text-white">
							From first enquiry to signed site visit.
						</h2>
					</Reveal>

					<Reveal delayMs={120} className="mt-10 grid gap-5 lg:grid-cols-3">
						{STEPS.map(({ label, title, text, icon: Icon }) => (
							<div key={label} className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_38px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#d8a94e]/30 hover:shadow-[0_26px_54px_rgba(0,0,0,0.45)]">
								<div className="flex items-center gap-3">
									<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#d8a94e]/15 text-sm font-semibold tracking-[0.14em] text-[#ffdf9e]">
										{label}
									</span>
									<span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[#ffdf9e]">
										<Icon size={16} />
									</span>
								</div>
								<h3 className="mt-5 text-2xl font-semibold leading-tight text-white">{title}</h3>
								<p className="mt-3 text-sm leading-7 text-white/65">{text}</p>
							</div>
						))}
					</Reveal>
				</div>
			</section>

		<section id="capabilities" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8">
				<Reveal className="mx-auto max-w-2xl text-center">
					<span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">What Basera does</span>
					<h2 className="mt-5 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">Leads, conversations, properties, and follow-ups in one place.</h2>
					<p className="mt-4 text-sm leading-7 text-white/65">
						Basera helps real-estate agencies manage leads, conversations, properties, AI qualification, property matching, follow-ups, appointments, and sales workflows.
					</p>
				</Reveal>

				<Reveal delayMs={120} className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
					<div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_38px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#d8a94e]/30 hover:shadow-[0_26px_54px_rgba(0,0,0,0.45)]">
						<CheckCircle2 size={22} className="text-[#ffdf9e]" />
						<h3 className="mt-4 text-lg font-semibold text-white">AI qualification</h3>
						<p className="mt-2 text-sm leading-7 text-white/65">Understands budget, city, BHK, timeline, and buying intent from natural conversation — including short replies and Hinglish.</p>
					</div>
					<div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_38px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#d8a94e]/30 hover:shadow-[0_26px_54px_rgba(0,0,0,0.45)]">
						<Building2 size={22} className="text-[#ffdf9e]" />
						<h3 className="mt-4 text-lg font-semibold text-white">Verified matching</h3>
						<p className="mt-2 text-sm leading-7 text-white/65">Recommends only properties that exist in your inventory. Never invents prices, availability, or listings.</p>
					</div>
					<div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_38px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#d8a94e]/30 hover:shadow-[0_26px_54px_rgba(0,0,0,0.45)]">
						<MessageSquareText size={22} className="text-[#ffdf9e]" />
						<h3 className="mt-4 text-lg font-semibold text-white">Website + WhatsApp</h3>
						<p className="mt-2 text-sm leading-7 text-white/65">One inbox for website chat and WhatsApp. The AI qualifies on both; agents take over with full context when needed.</p>
					</div>
					<div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_38px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#d8a94e]/30 hover:shadow-[0_26px_54px_rgba(0,0,0,0.45)]">
						<CalendarCheck2 size={22} className="text-[#ffdf9e]" />
						<h3 className="mt-4 text-lg font-semibold text-white">Pipeline visibility</h3>
						<p className="mt-2 text-sm leading-7 text-white/65">Live dashboard, lead scores, appointments, and follow-ups — so owners see exactly where every enquiry stands.</p>
					</div>
				</Reveal>
			</section>

			<section id="demo" className="relative scroll-mt-20 overflow-hidden border-y border-white/10 bg-[#0d1322]">
				<div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 55% 45% at 50% 0%, rgba(216,169,78,0.07), transparent 70%)" }} aria-hidden />
				<div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
					<Reveal className="mx-auto max-w-3xl text-center">
						<span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Try the demo</span>
						<h2 className="mt-5 font-display text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-white">
							See a buyer journey end to end.
						</h2>
						<p className="mt-4 text-sm leading-7 text-white/65">
							Use the chat on this page: tell the AI what you are looking for, watch it qualify you against demo inventory, and see the lead, conversation, and score appear in the dashboard. All demo data is clearly labeled.
						</p>
					</Reveal>

					<Reveal delayMs={120} className="mt-10 grid gap-5 lg:grid-cols-3">
						<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.3)] backdrop-blur-sm transition-colors duration-300 hover:border-[#d8a94e]/30">
							<p className="text-sm uppercase tracking-[0.12em] text-white/50">Step 1 · Chat</p>
							<p className="mt-3 text-lg font-semibold text-white">“I need a 2 BHK in Noida under ₹80 lakh.”</p>
							<p className="mt-2 text-sm text-white/65">The AI asks only what it still needs — budget, BHK, or location — and remembers your answers.</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.3)] backdrop-blur-sm transition-colors duration-300 hover:border-[#d8a94e]/30">
							<p className="text-sm uppercase tracking-[0.12em] text-white/50">Step 2 · Match</p>
							<p className="mt-3 text-lg font-semibold text-white">Verified demo properties only.</p>
							<p className="mt-2 text-sm text-white/65">Matches come from the demo inventory with real prices and availability — or the AI says no verified match was found.</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.3)] backdrop-blur-sm transition-colors duration-300 hover:border-[#d8a94e]/30">
							<p className="text-sm uppercase tracking-[0.12em] text-white/50">Step 3 · Convert</p>
							<p className="mt-3 text-lg font-semibold text-white">Lead + score in the CRM.</p>
							<p className="mt-2 text-sm text-white/65">Sign up free to explore the same flow with your own agency, properties, and team.</p>
						</div>
					</Reveal>

					<div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
						<Link href="/explore" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0a0e16] transition hover:bg-white/85">Find Properties <ArrowRight size={16} /></Link>
						<Link href="/login" className="inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-white/85 transition hover:border-white/50 hover:text-white">Staff Login</Link>
					</div>
				</div>
			</section>

			<section id="portfolio" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8">
				<Reveal className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
					<div>
						<span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Featured inventory</span>
						<h2 className="mt-4 font-display text-[clamp(2rem,3vw,2.6rem)] leading-tight text-white">High-conviction properties buyers actually want.</h2>
					</div>
					<Link href="/explore" className="inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-white/85 transition hover:border-white/50 hover:text-white">View all listings</Link>
				</Reveal>

				<Reveal delayMs={120} className="mt-8 grid gap-5 lg:grid-cols-3">
					{PROPERTY_SHOWCASE.map((property) => (
						<div key={property.name} className="group overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.04] shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#d8a94e]/30">
							{/* Same photo + same gradient grade as before; next/image
								lazy-loads below-the-fold cards with responsive sizes. */}
							<div className="relative h-56 overflow-hidden">
									<Image
										src={property.image}
										alt={`${property.name} — ${property.meta} at ${property.location}`}
										fill
										sizes="(max-width: 1024px) 100vw, 33vw"
										loading="lazy"
										className="object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.04]"
									/>
								<div
									className="absolute inset-0 transition-opacity duration-500"
									style={{ backgroundImage: "linear-gradient(180deg, rgba(11,26,38,0.08), rgba(11,26,38,0.55))" }}
									aria-hidden
								/>
								<div className="absolute inset-x-4 top-4 flex items-center justify-between gap-3">
									<span className="rounded-full border border-white/70 bg-white/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0a0e16] backdrop-blur-sm">Featured</span>
									<span className="rounded-full bg-[#d8a94e] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#1a1206] shadow-[0_6px_16px_rgba(216,169,78,0.35)]">AI match</span>
								</div>
							</div>

							<div className="p-5">
								<div className="flex items-start justify-between gap-3">
									<div>
										<p className="text-xl font-semibold text-white">{property.name}</p>
										<div className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
											<MapPin size={14} className="text-[#ffdf9e]" />
											<span>{property.location}</span>
										</div>
									</div>
									<span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/70">{property.meta}</span>
								</div>

								<div className="mt-5 flex items-end justify-between gap-2 border-t border-white/10 pt-4 transition-colors group-hover:border-[#d8a94e]/30">
									<div>
										<p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Starting at</p>
										<p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-[#ffdf9e]">{property.price}</p>
									</div>
									<span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#ffdf9e]">
										View details
										<ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
									</span>
								</div>
							</div>
						</div>
					))}
				</Reveal>
			</section>

			<section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20 sm:px-6 lg:px-8">
				<Reveal className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_42px_rgba(0,0,0,0.35)] backdrop-blur-sm md:p-8">
					<div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
						<div>
							<span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Start with your first pipeline</span>
							<h2 className="mt-4 font-display text-3xl text-white">A cleaner, smarter sales process for your brokerage.</h2>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row">
							<Link href="/explore" className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0a0e16] transition hover:bg-white/85">Find Properties</Link>
							<Link href="#demo" className="inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-white/85 transition hover:border-white/50 hover:text-white">See live demo</Link>
						</div>
					</div>

					<div className="mt-8 grid gap-4 md:grid-cols-3">
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors duration-300 hover:border-[#d8a94e]/25">
							<div className="flex items-center gap-3">
								<CalendarCheck2 className="text-[#ffdf9e]" size={18} />
								<p className="text-sm uppercase tracking-[0.12em] text-white/50">Lead capture</p>
							</div>
							<p className="mt-3 text-3xl font-semibold text-white">24/7</p>
							<p className="mt-2 text-sm text-white/65">Website, chat, and CRM enquiries are handled consistently.</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors duration-300 hover:border-[#d8a94e]/25">
							<div className="flex items-center gap-3">
								<ShieldCheck className="text-[#ffdf9e]" size={18} />
								<p className="text-sm uppercase tracking-[0.12em] text-white/50">Buyer matching</p>
							</div>
							<p className="mt-3 text-3xl font-semibold text-white">AI</p>
							<p className="mt-2 text-sm text-white/65">Every enquiry is qualified against budget, city, BHK, and intent.</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors duration-300 hover:border-[#d8a94e]/25">
							<div className="flex items-center gap-3">
								<TrendingUp className="text-[#ffdf9e]" size={18} />
								<p className="text-sm uppercase tracking-[0.12em] text-white/50">Sales visibility</p>
							</div>
							<p className="mt-3 text-3xl font-semibold text-white">Clear</p>
							<p className="mt-2 text-sm text-white/65">Hot leads and next steps stay visible across your sales team.</p>
						</div>
					</div>
				</Reveal>
			</section>

			<section id="trust" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20 sm:px-6 lg:px-8">
				<Reveal className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_42px_rgba(0,0,0,0.35)] backdrop-blur-sm md:p-8">
					<div className="max-w-2xl">
						<span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Security, CRM &amp; automation</span>
						<h2 className="mt-4 font-display text-[clamp(1.8rem,3vw,2.4rem)] leading-tight text-white">One system your team can be held to.</h2>
					</div>
					<ul className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
						<li>
							<ShieldCheck size={20} className="text-[#ffdf9e]" />
							<h3 className="mt-3 text-base font-semibold text-white">Role-based access</h3>
							<p className="mt-2 text-sm leading-7 text-white/65">Each seat sees only the leads, properties, and conversations it owns.</p>
						</li>
						<li>
							<Sparkles size={20} className="text-[#ffdf9e]" />
							<h3 className="mt-3 text-base font-semibold text-white">Grounded AI answers</h3>
							<p className="mt-2 text-sm leading-7 text-white/65">Recommendations come from your inventory — never from invented listings or prices.</p>
						</li>
						<li>
							<MessageSquareText size={20} className="text-[#ffdf9e]" />
							<h3 className="mt-3 text-base font-semibold text-white">Full conversation record</h3>
							<p className="mt-2 text-sm leading-7 text-white/65">Every message, qualification, and handoff stays attached to the lead.</p>
						</li>
						<li>
							<Workflow size={20} className="text-[#ffdf9e]" />
							<h3 className="mt-3 text-base font-semibold text-white">Rules you control</h3>
							<p className="mt-2 text-sm leading-7 text-white/65">Qualification criteria, scoring, and follow-up timing are configured by your team.</p>
						</li>
					</ul>
				</Reveal>
			</section>

			</main>

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
						{[
							{ href: "#platform", label: "Platform" },
							{ href: "#workflow", label: "Workflow" },
							{ href: "#capabilities", label: "Capabilities" },
							{ href: "#ai-videos", label: "AI Property Videos" },
							{ href: "/tour", label: "3D tour" },
							{ href: "/explore", label: "Find a Property" },
							{ href: "/buyer/login", label: "Buyer Login" },
							{ href: "/buyer/signup", label: "Create Buyer Account" },
							{ href: "/login", label: "Business Login" },
						].map((item) => (
							<Link key={item.href} href={item.href} className="transition-colors hover:text-[#ffdf9e]">
								{item.label}
							</Link>
						))}
					</nav>
					<p className="text-[13px] text-white/55">© {new Date().getFullYear()} Basera</p>
				</div>
			</footer>
			</div>

			<PublicChatWidget />
			<PublicVoiceButton />
		</>
	);
}
