declare module "pdf-parse" {
  interface PDFParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    version: string;
  }
  function pdfParse(data: Buffer | Uint8Array | ArrayBuffer, options?: { max?: number; version?: string }): Promise<PDFParseResult>;
  export default pdfParse;
}

declare module "mammoth" {
  interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  function convertToHtml(options: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
  export { convertToHtml };
}