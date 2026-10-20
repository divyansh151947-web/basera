import Link from "next/link";
import { getPilotReadiness, type ReadinessStatus } from "@/lib/pilot-readiness";

const DOT: Record<ReadinessStatus, string> = {
  ready: "bg-success-soft text-success",
  action: "bg-danger-soft text-danger",
  info: "bg-paper text-slate",
};

const MARK: Record<ReadinessStatus, string> = {
  ready: "✓",
  action: "!",
  info: "○",
};

/**
 * Pilot readiness panel (settings, admin-gated by middleware). Read-only
 * status display over existing rows/config — booleans rendered as
 * "Configured" / "Action required" / "Available". Never secrets.
 */
export async function PilotReadiness({ organizationId }: { organizationId: string }) {
  const readiness = await getPilotReadiness(organizationId);

  return (
    <div className="panel-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">Pilot readiness</h2>
          <p className="text-sm text-slate">
            {readiness.readyCount} ready · {readiness.actionCount} need{readiness.actionCount === 1 ? "s" : ""} action.
            Only safe status is shown — never keys or secrets.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {readiness.sections.map((section) => (
          <div key={section.key} className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">{section.title}</p>
            <ul className="mt-2 space-y-1.5">
              {section.checks.map((check) => {
                const row = (
                  <>
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${DOT[check.status]}`}
                    >
                      {MARK[check.status]}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {check.label}{" "}
                        <span className="font-normal text-slate">· {check.statusLabel}</span>
                      </span>
                      <span className="block truncate text-xs text-slate">{check.detail}</span>
                    </span>
                  </>
                );
                return (
                  <li
                    key={check.key}
                    className="inset-row flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    {check.href ? (
                      <Link href={check.href} className="flex min-w-0 flex-1 items-center gap-2 transition hover:text-brand">
                        {row}
                      </Link>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-2">{row}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
