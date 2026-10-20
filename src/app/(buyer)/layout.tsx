import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import BuyerSidebar from "@/components/buyer/BuyerSidebar";

// Authenticated buyer workspace: never surfaced in search results.
export const metadata: Metadata = {
  title: { default: "My Basera", template: "%s | Basera" },
  robots: { index: false, follow: false },
};

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/buyer/login");
  
  // Ensure only buyers can access this layout
  const role = (session.user as any).role;
  if (role !== "BUYER") redirect("/dashboard");

  return (
    <div className="flex min-h-screen bg-[#0a0e16]">
      <BuyerSidebar />
      <main className="theme-dark min-w-0 flex-1 bg-[radial-gradient(ellipse_60%_30%_at_50%_0%,rgba(216,169,78,0.06),transparent_70%),linear-gradient(180deg,#0a0e16_0%,#0c1220_100%)] px-4 py-6 text-white sm:px-6 md:p-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}