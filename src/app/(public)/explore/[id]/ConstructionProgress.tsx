"use client";

import { useState } from "react";
import { CalendarClock, CheckCircle, Clock, AlertCircle, HelpCircle, Loader2, MapPin, Building2, FileText } from "lucide-react";

interface ConstructionProgressProps {
  property: {
    possessionDate: string | null;
    availability: string;
    projectName: string;
    city: string;
    locality: string;
    propertyType: string;
  };
}

const MILESTONES = [
  { id: "foundation", label: "Foundation Completed", icon: Building2 },
  { id: "structure", label: "Structural Framework", icon: Building2 },
  { id: "brickwork", label: "Brickwork Completed", icon: Building2 },
  { id: "mep", label: "MEP Installation", icon: MapPin },
  { id: "finishing", label: "Interior Finishing", icon: MapPin },
  { id: "inspection", label: "Final Inspection", icon: FileText },
  { id: "handover", label: "Handover", icon: CalendarClock },
] as const;

function getMockMilestones(possessionDate: string | null, availability: string) {
  if (!possessionDate || availability === "AVAILABLE" || availability === "READY_TO_MOVE") {
    return MILESTONES.map((m, i) => ({
      ...m,
      status: "completed" as const,
      date: "2024-01-15",
    }));
  }

  const possession = new Date(possessionDate);
  const now = new Date();
  const monthsDiff = (possession.getFullYear() - now.getFullYear()) * 12 + possession.getMonth() - now.getMonth();
  
  return MILESTONES.map((m, i) => {
    let status: "completed" | "in_progress" | "pending" = "pending";
    if (monthsDiff <= 0) status = "completed";
    else if (i < Math.max(0, Math.floor(MILESTONES.length * (1 - monthsDiff / 12)))) status = "completed";
    else if (i === Math.max(0, Math.floor(MILESTONES.length * (1 - monthsDiff / 12)))) status = "in_progress";
    
    return {
      ...m,
      status,
      date: status !== "pending" ? "2024-06-15" : null,
    };
  });
}

function getProgressPercentage(milestones: ReturnType<typeof getMockMilestones>) {
  const completed = milestones.filter(m => m.status === "completed").length;
  const inProgress = milestones.filter(m => m.status === "in_progress").length;
  return Math.round((completed + inProgress * 0.5) / milestones.length * 100);
}

export function ConstructionProgress({ property }: ConstructionProgressProps) {
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  
  const milestones = getMockMilestones(property.possessionDate, property.availability);
  const progress = getProgressPercentage(milestones);
  const isReadyToMove = property.availability === "AVAILABLE" && property.possessionDate && new Date(property.possessionDate) <= new Date();
  const isUpcoming = property.availability === "UPCOMING";

  if (isReadyToMove) {
    return (
      <div className="panel-surface p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-success-soft p-3">
            <CheckCircle size={24} className="text-success" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Construction Complete — Ready to Move</h2>
            <p className="text-sm text-white/60 mt-1">This property has received occupancy certification and is ready for immediate possession.</p>
          </div>
        </div>
        {property.possessionDate && (
          <p className="mt-4 text-sm text-white/50 flex items-center gap-1.5">
            <CalendarClock size={14} /> Possession date: {property.possessionDate}
          </p>
        )}
      </div>
    );
  }

  if (isUpcoming) {
    return (
      <div className="panel-surface p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white/10 p-3 mt-0.5">
            <AlertCircle size={24} className="text-[#d8a94e]" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-white">Upcoming Project — Construction Not Started</h2>
            <p className="text-sm text-white/60 mt-1">
              This project is in the pre-launch phase. Construction timelines and milestones will be updated once the project breaks ground.
            </p>
            {property.possessionDate && (
              <p className="mt-3 text-sm text-white/50 flex items-center gap-1.5">
                <CalendarClock size={14} /> Expected possession: {property.possessionDate}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-surface p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Construction Progress</h2>
        <button
          onClick={() => setShowDisclaimer(!showDisclaimer)}
          className="flex items-center gap-1 text-xs text-white/50 hover:text-white/70"
          aria-expanded={showDisclaimer}
        >
          <HelpCircle size={14} /> What does this mean?
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/70">Overall Progress</span>
          <span className="font-semibold text-[#ffdf9e]">{progress}%</span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#d8a94e] to-[#e8c56d] rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-label="Overall construction progress"
            aria-valuetext={`${progress}%`}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      <div className="space-y-3">
        {milestones.map((milestone, index) => (
          <div key={milestone.id} className="flex items-start gap-4 group">
            <div className="relative flex-shrink-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  milestone.status === "completed" ? "bg-success border-2 border-success" :
                  milestone.status === "in_progress" ? "bg-[#d8a94e] border-2 border-[#d8a94e]" :
                  "bg-white/10 border-2 border-white/20"
                }`}
              >
                {milestone.status === "completed" ? (
                  <CheckCircle size={14} className="text-white" />
                ) : milestone.status === "in_progress" ? (
                  <Loader2 size={14} className="text-white animate-spin" />
                ) : (
                  <milestone.icon size={14} className="text-white/55" />
                )}
              </div>
              {index < milestones.length - 1 && (
                <div className="absolute left-3 top-8 bottom-8 w-0.5 bg-white/10" />
              )}
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{milestone.label}</span>
                {milestone.status === "in_progress" && (
                  <span className="rounded-full bg-[#d8a94e]/20 px-2 py-0.5 text-[10px] font-medium text-[#ffdf9e]">In Progress</span>
                )}
                {milestone.status === "completed" && (
                  <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-medium text-success">Completed</span>
                )}
              </div>
              {milestone.date && (
                <p className="mt-1 text-sm text-white/50 flex items-center gap-1.5">
                  <CalendarClock size={12} /> Completed: {milestone.date}
                </p>
              )}
              {milestone.status === "pending" && (
                <p className="mt-1 text-sm text-white/55">Scheduled</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {property.possessionDate && (
        <div className="pt-4 border-t border-white/10">
          <p className="text-sm text-white/60 flex items-center gap-1.5">
            <CalendarClock size={14} /> Expected possession: {property.possessionDate}
          </p>
        </div>
      )}

      {showDisclaimer && (
        <div className="pt-4 border-t border-white/10 bg-white/5 rounded-lg p-4 text-sm text-white/60">
          <p className="font-medium text-white/80 mb-2">About Construction Progress</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Progress is based on typical construction milestones and the expected possession date.</li>
            <li>Actual site conditions may vary. This is an indicative timeline, not a guarantee.</li>
            <li>For verified construction updates, please contact the developer or schedule a site visit.</li>
            <li>Milestone dates are illustrative and not from official project records.</li>
          </ul>
        </div>
      )}
    </div>
  );
}