import "server-only";

/**
 * EMBEDDING SERVICE
 *
 * Generates vector embeddings for text chunks using OpenAI's
 * text-embedding-3-small (1536 dimensions) or text-embedding-3-large (3072).
 *
 * Supports both batch and single embedding generation.
 */

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = EMBEDDING_MODEL === "text-embedding-3-large" ? 3072 : 1536;
const MAX_BATCH_SIZE = 100; // OpenAI max batch size
const MAX_TOKENS_PER_REQUEST = 8000; // Conservative limit

export type EmbeddingResult = {
  embeddings: number[][];
  usage: { inputTokens: number; totalTokens: number };
};

export type SingleEmbeddingResult = {
  embedding: number[];
  usage: { inputTokens: number; totalTokens: number };
};

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not configured. Embeddings require OpenAI API key.");
  return key;
}

export function embeddingsAreConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}

export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}

/**
 * Generate embeddings for multiple texts in batches
 */
export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult> {
  if (!embeddingsAreConfigured()) {
    throw new Error("OpenAI API key not configured for embeddings");
  }

  if (texts.length === 0) {
    return { embeddings: [], usage: { inputTokens: 0, totalTokens: 0 } };
  }

  // Filter empty texts
  const validTexts = texts.map((t, i) => (t?.trim() ? t.trim() : `[empty-${i}]`));

  const allEmbeddings: number[][] = [];
  let totalInputTokens = 0;
  let totalTokens = 0;

  // Process in batches
  for (let i = 0; i < validTexts.length; i += MAX_BATCH_SIZE) {
    const batch = validTexts.slice(i, i + MAX_BATCH_SIZE);

    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
        encoding_format: "float",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI embeddings API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const batchEmbeddings = data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((d: { embedding: number[] }) => d.embedding);

    allEmbeddings.push(...batchEmbeddings);
    totalInputTokens += data.usage?.prompt_tokens || 0;
    totalTokens += data.usage?.total_tokens || 0;
  }

  return {
    embeddings: allEmbeddings,
    usage: { inputTokens: totalInputTokens, totalTokens },
  };
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<SingleEmbeddingResult> {
  const result = await generateEmbeddings([text]);
  return {
    embedding: result.embeddings[0] || [],
    usage: result.usage,
  };
}

/**
 * Cosine similarity between two vectors (for SQLite/local retrieval)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find top-k most similar vectors (for SQLite/local retrieval)
 */
export function findTopKSimilar(
  queryEmbedding: number[],
  candidateEmbeddings: number[][],
  k: number
): Array<{ index: number; score: number }> {
  const scored = candidateEmbeddings.map((emb, index) => ({
    index,
    score: cosineSimilarity(queryEmbedding, emb),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Estimate token count for text (rough approximation: 1 token ≈ 4 chars)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within token limit
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}