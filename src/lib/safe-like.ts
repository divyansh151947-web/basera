/**
 * Escape `%`, `_`, and `\` so caller-supplied text is matched literally
 * inside a SQL LIKE pattern. Drizzle parameterizes values (no SQL
 * injection), but without escaping a search for `%` would act as a
 * wildcard and return far more rows than intended.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Wrap escaped text as a `%contains%` LIKE operand. */
export function likeContains(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}
