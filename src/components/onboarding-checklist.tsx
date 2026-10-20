import Link from "next/link";
import { getOrganization, getAIConfig, listTeam } from "@/lib/data/org";
import { getWhatsAppIntegration } from "@/lib/data/integrations";
import { listProperties } from "@/lib/data/properties";
import { getDashboardCounts } from "@/lib/data/leads";

/** Simple agency onboarding checklist (Phase 4, Part 12) using live data.
 * Links into the existing pages — no new architecture. */
export async function OnboardingChecklist({ organizationId }: { organizationId: string }) {
  const [org, team, properties, counts, aiConfig, whatsapp] = await Promise.all([
    getOrganization(organizationId),
    listTeam(organizationId),
    listProperties(organizationId),
    getDashboardCounts(organizationId),
    getAIConfig(organizationId),
    getWhatsAppIntegration(organizationId).catch(() => null),
  ]);

  const steps = [
    {
      label: "Add company information",
      done: Boolean(org?.phone || org?.email),
      href: "/settings",
    },
    {
      label: "Add properties",
      done: properties.length > 0,
      href: "/properties",
    },
    {
      label: "Add sales team",
      done: team.length > 1,
      href: "/team",
    },
    {
      label: "Configure AI",
      done: Boolean(aiConfig && aiConfig.greeting && aiConfig.tone),
      href: "/settings",
    },
    {
      label: "Connect WhatsApp",
      done: Boolean(whatsapp?.integration?.isEnabled),
      href: "/settings",
    },
    {
      label: "Start receiving leads",
      done: counts.total > 0,
      href: "/leads",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <div className="panel-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">Get your agency live</h2>
          <p className="text-sm text-slate">
            {doneCount} of {steps.length} steps complete.
          </p>
        </div>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => (
          <li key={step.label}>
            <Link
              href={step.href}
              className="inset-row flex items-center gap-2 px-3 py-2 text-sm"
            >
              <span
                aria-hidden
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                  step.done ? "bg-success-soft text-success" : "bg-paper text-slate"
                }`}
              >
                {step.done ? "✓" : "○"}
              </span>
              <span className={step.done ? "text-slate line-through" : "font-medium text-ink"}>{step.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
