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

export function resolvePublicChatOrgSlug(value: string | null | undefined): string {
  if (typeof value !== "string") return DEFAULT_PUBLIC_CHAT_ORG_SLUG;
  const slug = value.trim();
  return slug || DEFAULT_PUBLIC_CHAT_ORG_SLUG;
}
