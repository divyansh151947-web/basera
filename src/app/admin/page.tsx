import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Platform admin",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session?.user || (session.user as any).role !== "SUPER_ADMIN") redirect("/dashboard");
  return (
    <div className="theme-dark min-h-screen bg-[#0a0e16] p-8 text-white">
      <h1 className="font-display text-2xl text-ink">Platform admin</h1>
      <p className="text-sm text-slate2 mt-2">Super-admin console (organizations, plans, platform usage) — coming in the next revision.</p>
    </div>
  );
}
