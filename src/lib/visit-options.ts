import { formatInr } from "@/lib/formatters";

/**
 * Buyer "Schedule a visit" — property dropdown options.
 *
 * Pure + isomorphic so the option text (including long property names) can be
 * unit-tested without a DOM. The full label is what an accessible listbox
 * announces and what a tooltip reveals when a narrow control truncates it.
 */
export interface VisitPropertyOption {
  id: string;
  projectName: string;
  city: string;
  locality: string;
  priceMinInr: number;
}

export interface DropdownOption {
  value: string;
  label: string;
}

export function buildVisitPropertyOptions(properties: readonly VisitPropertyOption[]): DropdownOption[] {
  return properties.map((p) => ({
    value: p.id,
    label: `${p.projectName} — ${p.locality}, ${p.city} (${formatInr(p.priceMinInr)})`,
  }));
}