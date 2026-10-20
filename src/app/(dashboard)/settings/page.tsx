import WhatsAppIntegration from "./whatsapp-integration";
import { OrganizationForm, AIConfigForm } from "./settings-forms";
import { PilotReadiness } from "./pilot-readiness";
import { getCurrentSession } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await getCurrentSession();
  const organizationId = (session?.user as any)?.organizationId as string | undefined;

  return (
    <div className="space-y-6">
      <div>
        <span className="eyebrow">Workspace</span>
        <h1 className="mt-3 font-display text-3xl text-ink">Settings</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <OrganizationForm />
        <AIConfigForm />
      </div>
      <WhatsAppIntegration />
      {organizationId && <PilotReadiness organizationId={organizationId} />}
    </div>
  );
}
