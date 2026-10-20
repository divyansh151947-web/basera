/**
 * Tiny sessionStorage-backed draft storage for forms.
 *
 * Purpose: data preservation on back/refresh. When a user navigates away
 * from a long form (browser back, refresh, accidental tab navigation) and
 * returns, their unsaved input is restored instead of silently lost.
 *
 * Constraints:
 *  - Frontend-only: drafts never leave the browser (sessionStorage is
 *    scoped to the tab and is not sent with requests).
 *  - SSR-safe: every accessor is a no-op on the server.
 *  - Best-effort: storage failures (private mode, quota) are swallowed —
 *    the app must keep working without drafts.
 */

const PREFIX = "basera:draft:";

export function readDraft<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" ? parsed : null) as T | null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable/full — drafts are best-effort */
  }
}

export function clearDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
