import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session?.user || (session.user as any).role !== "SUPER_ADMIN") redirect("/dashboard");
  return (
    <div className="min-h-screen bg-paper p-8">
      <h1 className="font-display text-2xl text-ink">Platform admin</h1>
      <p className="text-sm text-slate2 mt-2">Super-admin console (organizations, plans, platform usage) — coming in the next revision.</p>
    </div>
  );
}
