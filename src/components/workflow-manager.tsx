"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Play,
  ShieldAlert,
  Clock,
  Mail,
} from "lucide-react";

const TRIGGER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "new_lead", label: "New lead created" },
  { value: "lead_assigned", label: "Lead assigned" },
  { value: "lead_status_changed", label: "Lead status changed" },
  { value: "lead_inactive", label: "Lead becomes inactive" },
  { value: "followup_overdue", label: "Follow-up overdue" },
  { value: "priority_changed", label: "Priority changed" },
  { value: "property_match_available", label: "Property match available" },
  { value: "appointment_scheduled", label: "Appointment scheduled" },
  { value: "appointment_status_changed", label: "Appointment status changed" },
  { value: "recovery_status_changed", label: "Recovery status changed" },
];

const ACTION_OPTIONS: Array<{ value: string; label: string; icon: any }> = [
  { value: "create_task", label: "Create task", icon: Play },
  { value: "schedule_reminder", label: "Schedule reminder", icon: Clock },
  { value: "assign_lead", label: "Assign a lead", icon: Mail },
  { value: "escalate_lead", label: "Escalate lead", icon: ShieldAlert },
];

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  triggersJson: string;
  conditionsJson: string;
  actionsJson: string;
  createdAt: string;
};

type Execution = {
  id: string;
  status: string;
  triggered_by: string;
  result_summary: string | null;
  created_at: string;
  definition_name: string | null;
};

export function WorkflowManager({
  initialWorkflows,
  organizationId,
}: {
  initialWorkflows: Workflow[];
  organizationId: string;
}) {
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    triggers: [] as string[],
    actions: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [wRes, eRes] = await Promise.all([
        fetch(`/api/workflows`),
        fetch(`/api/workflows/executions`),
      ]);
      if (wRes.ok) {
        const wData = await wRes.json();
        setWorkflows(wData.workflows || []);
      }
      if (eRes.ok) {
        const eData = await eRes.json();
        setExecutions(eData.executions || []);
      }
    } catch {
      setError("Failed to load workflows.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          triggersJson: JSON.stringify(form.triggers),
          conditionsJson: JSON.stringify({}),
          actionsJson: JSON.stringify(form.actions),
        }),
      });
      if (!res.ok) throw new Error("Failed to create workflow.");
      setSuccess("Workflow created.");
      setOpenForm(false);
      setForm({ name: "", description: "", triggers: [], actions: [] });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workflow.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (w: Workflow) => {
    setDeleting(w.id);
    try {
      const res = await fetch(`/api/workflows/${w.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isEnabled: !w.isEnabled }),
      });
      if (!res.ok) throw new Error("Failed to update workflow.");
      await load();
    } catch {
      setError("Failed to update workflow.");
    } finally {
      setDeleting(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this workflow? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete workflow.");
      setSuccess("Workflow deleted.");
      await load();
    } catch {
      setError("Failed to delete workflow.");
    } finally {
      setDeleting(null);
    }
  };

  const triggerBadge = (t: string) => {
    const tOpt = TRIGGER_OPTIONS.find((o) => o.value === t);
    return tOpt ? tOpt.label : t;
  };

  const actionBadge = (a: string) => {
    const aOpt = ACTION_OPTIONS.find((o) => o.value === a);
    return aOpt ? aOpt.label : a;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => { setOpenForm(true); setError(null); setSuccess(null); }}
          className="inline-flex items-center gap-2 text-xs font-medium text-brand hover:text-brand/80 transition-colors"
        >
          <Plus size={14} /> Add workflow
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-brand/30 bg-brand-soft px-3 py-2 text-sm text-brand">
          {success}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-panel-soft text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate">
              <th className="px-4 py-3">Workflow</th>
              <th className="px-4 py-3">Triggers</th>
              <th className="px-4 py-3">Actions</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-slate2 divide-y divide-line">
            {workflows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate2">
                  No workflows defined yet. Create your first automated rule.
                </td>
              </tr>
            ) : (
              workflows.map((w) => {
                const triggers = JSON.parse(w.triggersJson ?? "[]");
                const actions = JSON.parse(w.actionsJson ?? "[]");
                return (
                  <tr key={w.id} className="text-[12px] group">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{w.name}</p>
                      {w.description && (
                        <p className="text-xs text-slate2">{w.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {triggers.length === 0 ? (
                        <span className="text-slate2">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {triggers.map((t: string) => (
                            <span
                              key={t}
                              className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand"
                            >
                              {triggerBadge(t)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {actions.length === 0 ? (
                        <span className="text-slate2">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {actions.map((a: string) => (
                            <span
                              key={a}
                              className="rounded-full bg-gold-light px-2 py-0.5 text-[10px] font-medium text-gold"
                            >
                              {actionBadge(a)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(w)}
                        disabled={deleting === w.id}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                          w.isEnabled
                            ? "bg-brand-soft text-brand toggle-on"
                            : "bg-paper text-slate toggle-off"
                        }`}
                      >
                        {w.isEnabled ? "Enabled" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(w.id)}
                        disabled={deleting === w.id}
                        className="text-xs text-danger hover:text-danger/80"
                      >
                        {deleting === w.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate mb-3">
          Recent executions
        </h3>
        {executions.length === 0 ? (
          <p className="text-xs text-slate2">No executions recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {executions.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-center justify-between p-2 rounded-md bg-panel border border-line text-xs">
                <div>
                  <p className="font-medium text-ink">{e.definition_name ?? "Workflow"}</p>
                  <p className="text-[10px] text-slate2">{e.triggered_by}</p>
                </div>
                <div className="text-right">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      e.status === "COMPLETED"
                        ? "bg-brand-soft text-brand"
                        : e.status === "FAILED"
                        ? "bg-danger-soft text-danger"
                        : "bg-paper text-slate"
                    }`}
                  >
                    {e.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {openForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpenForm(false)}
          />
          <div className="bg-panel rounded-xl border border-line p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-ink">Create workflow</h3>
              <button
                onClick={() => setOpenForm(false)}
                className="text-slate hover:text-ink"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate mb-1.5">
                  Workflow name
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate mb-1.5">
                  Description
                </label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate mb-1.5">
                  Triggers
                </label>
                <div className="flex flex-wrap gap-2">
                  {TRIGGER_OPTIONS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          triggers: prev.triggers.includes(t.value)
                            ? prev.triggers.filter((x) => x !== t.value)
                            : [...prev.triggers, t.value],
                        }));
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                        form.triggers.includes(t.value)
                          ? "bg-brand-soft text-brand border-brand"
                          : "bg-white/5 text-slate border-white/15 hover:border-white/30"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate2 mt-1">
                  Select events that start this workflow.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate mb-1.5">
                  Actions
                </label>
                <div className="flex flex-wrap gap-2">
                  {ACTION_OPTIONS.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          actions: prev.actions.includes(a.value)
                            ? prev.actions.filter((x) => x !== a.value)
                            : [...prev.actions, a.value],
                        }));
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                        form.actions.includes(a.value)
                          ? "bg-gold-light text-gold border-gold"
                          : "bg-white/5 text-slate border-white/15 hover:border-white/30"
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate2 mt-1">
                  Select actions to run when the workflow triggers.
                </p>
              </div>
              <div className="flex items-center justify-between pt-3">
                <button
                  type="button"
                  onClick={() => setOpenForm(false)}
                  className="text-xs text-slate hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-white bg-brand rounded-xl hover:bg-brand/90 disabled:opacity-50"
                >
                  {saving ? "Creating…" : "Create workflow"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
