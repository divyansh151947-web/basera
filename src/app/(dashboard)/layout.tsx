import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getOrganization } from "@/lib/data/org";
import Sidebar from "@/components/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const { role, organizationId } = session.user as any;

  const org = organizationId ? await getOrganization(organizationId) : null;

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar role={role} orgName={org?.name ?? "Basera"} />
      <main className="flex-1 min-w-0 p-6 md:p-8">{children}</main>
    </div>
  );
}
