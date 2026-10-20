import "server-only";

/**
 * DOCUMENT INGESTION SERVICE
 *
 * Parses various file formats into text chunks for knowledge base indexing.
 * Supports: PDF, DOCX, TXT, MD, CSV, JSON
 * Returns chunks with metadata (page, section, heading, source type).
 */

export type SupportedFileType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain"
  | "text/markdown"
  | "text/csv"
  | "application/json"
  | "text/csv";

export type IngestionResult = {
  chunks: Array<{
    content: string;
    index: number;
    metadata: {
      page?: number;
      section?: string;
      heading?: string;
      sourceType: string;
      charStart: number;
      charEnd: number;
      jsonPath?: string;
    };
  }>;
  totalChars: number;
  estimatedTokens: number;
};

function getFileTypeFromMime(mime: string): SupportedFileType | null {
  const mimeMap: Record<string, SupportedFileType> = {
    "application/pdf": "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain": "text/plain",
    "text/markdown": "text/markdown",
    "text/csv": "text/csv",
    "application/json": "application/json",
  };
  return mimeMap[mime] || null;
}

function getFileTypeFromName(name: string): SupportedFileType | null {
  const ext = name.toLowerCase().split(".").pop();
  const extMap: Record<string, SupportedFileType> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
  };
  return extMap[ext || ""] || null;
}

/**
 * Main ingestion entry point. Detects file type and routes to appropriate parser.
 */
export async function ingestDocument(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<IngestionResult> {
  const fileType = getFileTypeFromMime(mimeType || "") || getFileTypeFromName(fileName);

  if (!fileType) {
    throw new Error(`Unsupported file type: ${mimeType || fileName}`);
  }

  switch (fileType) {
    case "application/pdf":
      return ingestPdf(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return ingestDocx(buffer);
    case "text/plain":
      return ingestText(buffer.toString("utf-8"), "plain");
    case "text/markdown":
      return ingestText(buffer.toString("utf-8"), "markdown");
    case "text/csv":
      return ingestCsv(buffer.toString("utf-8"));
    case "application/json":
      return ingestJson(buffer.toString("utf-8"));
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * PDF ingestion using dynamic import of pdf-parse (optional dependency)
 */
async function ingestPdf(buffer: Buffer): Promise<IngestionResult> {
  try {
    // Dynamic import to avoid requiring pdf-parse as mandatory dependency
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule as any).default || pdfParseModule;
    const data = await pdfParse(buffer);

    const fullText = data.text;
    const chunks = chunkText(fullText, { chunkSize: 1200, overlap: 200 });

    return {
      chunks: chunks.map((chunk, i) => ({
        content: chunk.text,
        index: i,
        metadata: {
          page: chunk.page,
          section: chunk.section,
          heading: chunk.heading,
          sourceType: "pdf",
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
        },
      })),
      totalChars: fullText.length,
      estimatedTokens: Math.ceil(fullText.length / 4),
    };
  } catch (err) {
    throw new Error(`PDF parsing failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * DOCX ingestion using dynamic import of mammoth (optional dependency)
 */
async function ingestDocx(buffer: Buffer): Promise<IngestionResult> {
  try {
    const mammoth = await import("mammoth");
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;

    // Convert HTML to text (basic stripping)
    const text = html
      .replace(/<[^>]*>/g, "\n")
      .replace(/\s+/g, " ")
      .trim();

    const chunks = chunkText(text, { chunkSize: 1200, overlap: 200 });

    return {
      chunks: chunks.map((chunk, i) => ({
        content: chunk.text,
        index: i,
        metadata: {
          section: chunk.section,
          heading: chunk.heading,
          sourceType: "docx",
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
        },
      })),
      totalChars: text.length,
      estimatedTokens: Math.ceil(text.length / 4),
    };
  } catch (err) {
    throw new Error(`DOCX parsing failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Plain text / Markdown ingestion
 */
function ingestText(text: string, sourceType: "plain" | "markdown"): IngestionResult {
  const chunks = chunkText(text, { chunkSize: 1200, overlap: 200 });

  return {
    chunks: chunks.map((chunk, i) => ({
      content: chunk.text,
      index: i,
      metadata: {
        section: chunk.section,
        heading: chunk.heading,
        sourceType,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
      },
    })),
    totalChars: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
  };
}

/**
 * CSV ingestion - each row becomes a chunk with column headers as context
 */
function ingestCsv(csvText: string): IngestionResult {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV must have at least a header row and one data row");
  }

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1);

  const chunks = rows.map((row, rowIndex) => {
    const values = row.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = values[i] || ""));

    // Create a readable text representation
    const content = headers
      .map((h) => `${h}: ${obj[h]}`)
      .join("; ");

    return {
      content,
      index: rowIndex,
      metadata: {
        sourceType: "csv",
        rowIndex,
        columns: headers,
        charStart: rowIndex * 100,
        charEnd: (rowIndex + 1) * 100,
      },
    };
  });

  const fullText = chunks.map((c) => c.content).join("\n");
  return {
    chunks,
    totalChars: fullText.length,
    estimatedTokens: Math.ceil(fullText.length / 4),
  };
}

/**
 * JSON ingestion - flattens objects into readable chunks
 */
function ingestJson(jsonText: string): IngestionResult {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON");
  }

  const chunks: IngestionResult["chunks"] = [];

  function flatten(obj: unknown, prefix = "", index = 0): void {
    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => flatten(item, `${prefix}[${i}]`, index++));
      return;
    }

    if (typeof obj === "object") {
      const entries = Object.entries(obj as Record<string, unknown>);
      if (entries.length === 0) return;

      // For large objects, create chunks per key
      if (entries.length > 10) {
        entries.forEach(([key, value], i) => {
          const content = `${prefix}.${key}: ${JSON.stringify(value)}`;
          chunks.push({
            content,
            index: chunks.length,
            metadata: {
              sourceType: "json",
              jsonPath: `${prefix}.${key}`,
              charStart: chunks.length * 200,
              charEnd: (chunks.length + 1) * 200,
            },
          });
        });
        return;
      }

      // Small object - single chunk
      const content = entries.map(([k, v]) => `${prefix}.${k}: ${v}`).join("; ");
      chunks.push({
        content,
        index: chunks.length,
        metadata: {
          sourceType: "json",
          jsonPath: prefix,
          charStart: chunks.length * 200,
          charEnd: (chunks.length + 1) * 200,
        },
      });
      return;
    }

    // Primitive value
    chunks.push({
      content: `${prefix}: ${String(obj)}`,
      index: chunks.length,
      metadata: {
        sourceType: "json",
        jsonPath: prefix,
        charStart: chunks.length * 200,
        charEnd: (chunks.length + 1) * 200,
      },
    });
  }

  flatten(data);

  const fullText = chunks.map((c) => c.content).join("\n");
  return {
    chunks,
    totalChars: fullText.length,
    estimatedTokens: Math.ceil(fullText.length / 4),
  };
}

/**
 * Text chunking with overlap, preserving headings and sections
 */
function chunkText(
  text: string,
  opts: { chunkSize: number; overlap: number }
): Array<{
  text: string;
  page?: number;
  section?: string;
  heading?: string;
  charStart: number;
  charEnd: number;
}> {
  const { chunkSize, overlap } = opts;
  const chunks: Array<{
    text: string;
    page?: number;
    section?: string;
    heading?: string;
    charStart: number;
    charEnd: number;
  }> = [];

  // Split by headings first (markdown style)
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const sections: Array<{ heading: string; level: number; start: number; content: string }> = [];

  let lastMatch: RegExpExecArray | null;
  let lastEnd = 0;
  while ((lastMatch = headingRegex.exec(text)) !== null) {
    if (lastMatch.index > lastEnd) {
      sections.push({
        heading: "",
        level: 0,
        start: lastEnd,
        content: text.slice(lastEnd, lastMatch.index),
      });
    }
    sections.push({
      heading: lastMatch[2],
      level: lastMatch[1].length,
      start: lastMatch.index,
      content: "",
    });
    lastEnd = headingRegex.lastIndex;
  }
  if (lastEnd < text.length) {
    sections.push({
      heading: "",
      level: 0,
      start: lastEnd,
      content: text.slice(lastEnd),
    });
  }

  // Now chunk each section
  let charOffset = 0;
  for (const section of sections) {
    const sectionText = section.content || text.slice(section.start, headingRegex.lastIndex);
    const words = sectionText.split(/\s+/);
    let currentChunk = "";
    let chunkStart = charOffset;

    for (const word of words) {
      if (currentChunk.length + word.length + 1 > chunkSize && currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          heading: section.heading || undefined,
          section: section.heading || undefined,
          charStart: chunkStart,
          charEnd: charOffset,
        });
        // Start new chunk with overlap
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + " " + word;
        chunkStart = charOffset - overlap;
      } else {
        currentChunk += (currentChunk ? " " : "") + word;
      }
      charOffset += word.length + 1;
    }

    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        heading: section.heading || undefined,
        section: section.heading || undefined,
        charStart: chunkStart,
        charEnd: charOffset,
      });
    }
    charOffset += sectionText.length;
  }

  return chunks;
}

/**
 * Validate file before ingestion
 */
export function validateFileForIngestion(
  fileName: string,
  mimeType: string,
  size: number,
  maxSizeMb = 50
): { valid: boolean; error?: string } {
  const supportedTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
  ];

  if (!supportedTypes.includes(mimeType)) {
    const ext = fileName.toLowerCase().split(".").pop();
    const supportedExts = ["pdf", "docx", "txt", "md", "csv", "json"];
    if (!ext || !supportedExts.includes(ext)) {
      return {
        valid: false,
        error: `Unsupported file type. Supported: PDF, DOCX, TXT, MD, CSV, JSON`,
      };
    }
  }

  if (size > maxSizeMb * 1024 * 1024) {
    return {
      valid: false,
      error: `File size exceeds ${maxSizeMb}MB limit`,
    };
  }

  return { valid: true };
}