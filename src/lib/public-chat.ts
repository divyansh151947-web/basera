/** Shared public-workspace selection for the website chat widget.
 *
 * The demonstrated Basera deployment ships with one default workspace
 * (`urbannest`), but deployments can target another seeded workspace by setting
 * `NEXT_PUBLIC_PUBLIC_ORG_SLUG`. Only a non-empty, trimmed value overrides the
 * default; callers can never pass an arbitrary tenant through the URL, because
 * the server still resolves and validates the slug in
 * `POST /api/public/chat`.
 */
export const DEFAULT_PUBLIC_CHAT_ORG_SLUG = "urbannest";

/**
 * Shown in the public chat/voice panels when the server reports the configured
 * workspace slug doesn't exist (404 "Unknown business" from the org lookup).
 * The technical payload would read like jargon ("Unknown business"); this
 * tells the buyer the assistant is temporarily unavailable instead.
 */
export const PUBLIC_ORG_UNAVAILABLE_MESSAGE =
  "Basera AI isn't connected to this workspace yet — our team is finishing the setup. Please check back soon, or type your question below.";

export function isPublicOrgUnavailableError(message: string | null | undefined): boolean {
  if (typeof message !== "string") return false;
  return /unknown business/i.test(message);
}

export function resolvePublicChatOrgSlug(value: string | null | undefined): string {
  if (typeof value !== "string") return DEFAULT_PUBLIC_CHAT_ORG_SLUG;
  const slug = value.trim();
  return slug || DEFAULT_PUBLIC_CHAT_ORG_SLUG;
}
