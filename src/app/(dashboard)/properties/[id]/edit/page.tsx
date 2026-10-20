import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getPropertyById } from "@/lib/data/properties";
import { EditPropertyForm } from "@/components/EditPropertyForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");

  const organizationId = (session.user as any).organizationId as string;
  const property = await getPropertyById(organizationId, id);
  if (!property) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/properties/${id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-white/60 hover:text-white transition">
          <ArrowLeft size={14} />
          Back to property
        </Link>
        <h1 className="mt-3 font-display text-2xl text-white">Edit Property</h1>
        <p className="mt-1 text-sm text-white/50">{property.projectName}</p>
      </div>

      <div className="panel-surface p-6">
        <EditPropertyForm
          propertyId={id}
          organizationId={organizationId}
        />
      </div>
    </div>
  );
}
