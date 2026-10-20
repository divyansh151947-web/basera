/**
 * LEAD PIPELINE (single source of truth for deal stages)
 * ------------------------------------------------------------------
 * Maps the 9 persisted lead statuses onto the sales pipeline a
 * salesperson actually works:
 *
 *   New → Contacted → Qualified → Property Shortlisted → Site Visit
 *       → Negotiation → Won / Lost        (+ Nurture as a holding state)
 *
 * The statuses are NOT changed in the database — INTERESTED is the
 * "Property Shortlisted" stage, SITE_VISIT_SCHEDULED is the "Site Visit"
 * stage and CONVERTED/LOST together are the terminal "Won / Lost" stage.
 * Everything here is pure so the table view, the board view, the status
 * controls and the analytics funnel all agree on one ordering.
 */

export interface PipelineStage {
  key: string;
  label: string;
  /** Short line shown on the board column header. */
  hint: string;
  /** Lead statuses that count as being in this stage. */
  statuses: string[];
  /** Holding states that sit outside the main deal flow. */
  offPipeline?: boolean;
  /** Terminal stages — a lead here is closed. */
  terminal?: boolean;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { key: "NEW", label: "New", hint: "Enquiry received", statuses: ["NEW"] },
  { key: "CONTACTED", label: "Contacted", hint: "First response done", statuses: ["CONTACTED"] },
  { key: "QUALIFIED", label: "Qualified", hint: "Requirement confirmed", statuses: ["QUALIFIED"] },
  { key: "SHORTLISTED", label: "Property Shortlisted", hint: "Homes shared / saved", statuses: ["INTERESTED"] },
  { key: "SITE_VISIT", label: "Site Visit", hint: "Visit scheduled", statuses: ["SITE_VISIT_SCHEDULED"] },
  { key: "NEGOTIATION", label: "Negotiation", hint: "Price / terms talk", statuses: ["NEGOTIATION"] },
  { key: "WON_LOST", label: "Won / Lost", hint: "Closed", statuses: ["CONVERTED", "LOST"], terminal: true },
  { key: "NURTURE", label: "Nurture", hint: "Long-term, not active", statuses: ["NURTURE"], offPipeline: true },
];

/** Canonical status order used by filters, selects and the board. */
export const PIPELINE_STATUSES: string[] = PIPELINE_STAGES.flatMap((s) => s.statuses);

/** Friendly labels for every status (used by badges, chips and selects). */
export const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  INTERESTED: "Property shortlisted",
  SITE_VISIT_SCHEDULED: "Site visit",
  NEGOTIATION: "Negotiation",
  CONVERTED: "Won",
  LOST: "Lost",
  NURTURE: "Nurture",
};

const STAGE_BY_STATUS: Record<string, PipelineStage> = {};
for (const stage of PIPELINE_STAGES) {
  for (const status of stage.statuses) STAGE_BY_STATUS[status] = stage;
}

export function stageForStatus(status: string): PipelineStage {
  return STAGE_BY_STATUS[status] ?? { key: status, label: status, hint: "", statuses: [status] };
}

export function stageLabelForStatus(status: string): string {
  return stageForStatus(status).label;
}

export function isClosedStatus(status: string): boolean {
  return status === "CONVERTED" || status === "LOST";
}

/** The status a salesperson should move a lead to next (null when done). */
export const NEXT_STATUS: Record<string, string | null> = {
  NEW: "CONTACTED",
  CONTACTED: "QUALIFIED",
  QUALIFIED: "INTERESTED",
  INTERESTED: "SITE_VISIT_SCHEDULED",
  SITE_VISIT_SCHEDULED: "NEGOTIATION",
  NEGOTIATION: "CONVERTED",
  CONVERTED: null,
  LOST: null,
  NURTURE: "CONTACTED",
};

export function nextStatusFor(status: string): string | null {
  return Object.prototype.hasOwnProperty.call(NEXT_STATUS, status) ? NEXT_STATUS[status] : null;
}

/** Where the deal stands as a 1-based position inside the main flow. */
export function stagePosition(status: string): number {
  const stage = stageForStatus(status);
  const index = PIPELINE_STAGES.filter((s) => !s.offPipeline).findIndex((s) => s.key === stage.key);
  return index < 0 ? 0 : index + 1;
}
