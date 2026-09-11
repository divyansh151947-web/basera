import "server-only";
import { listKnowledgeDocs } from "@/lib/data/org";
import { listProperties } from "@/lib/data/properties";

/**
 * Retrieval-before-generation (Section 20/41): before the conversation agent
 * calls Claude, we pull the organization's OWN verified data — properties +
 * knowledge base articles — and inject only that into the prompt as
 * "VERIFIED BUSINESS DATA". The system prompt (see conversation-agent.ts)
 * instructs the model it may not state anything about price/availability/
 * amenities that isn't present in this block. This is a simple keyword-match
 * retriever; swap for a vector store as the knowledge base grows.
 */

function keywordScore(text: string, query: string): number {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const haystack = text.toLowerCase();
  return words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
}

export async function retrieveKnowledgeContext(organizationId: string, query: string, opts: { city?: string } = {}) {
  const [docs, properties] = await Promise.all([
    listKnowledgeDocs(organizationId),
    listProperties(organizationId, { city: opts.city }),
  ]);

  const rankedDocs = docs
    .map((d) => ({ d, score: keywordScore(`${d.title} ${d.content}`, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.d);

  const propertySummaries = properties.slice(0, 12).map((p) => ({
    id: p.id,
    project: p.projectName,
    developer: p.developer,
    type: p.propertyType,
    bhk: p.bhk,
    city: p.city,
    locality: p.locality,
    priceRangeInr: [p.priceMinInr, p.priceMaxInr],
    areaSqft: p.areaSqft,
    availability: p.availability,
    possessionDate: p.possessionDate,
    amenities: p.amenitiesJson ? JSON.parse(p.amenitiesJson) : [],
    furnishing: p.furnishing,
  }));

  return {
    faqDocs: rankedDocs.map((d) => ({ title: d.title, content: d.content })),
    properties: propertySummaries,
  };
}

export function formatVerifiedDataBlock(context: Awaited<ReturnType<typeof retrieveKnowledgeContext>>): string {
  return [
    "VERIFIED BUSINESS DATA (the ONLY source you may use for prices, availability, amenities, possession dates, or policies):",
    "",
    "Properties currently in inventory:",
    JSON.stringify(context.properties, null, 0),
    "",
    "Relevant FAQ/policy documents:",
    context.faqDocs.length ? JSON.stringify(context.faqDocs) : "(none matched this query)",
  ].join("\n");
}
