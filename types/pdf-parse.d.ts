declare module "pdf-parse" {
  export interface PdfParseResult {
    text: string;
    [key: string]: unknown;
  }

  export default function pdfParse(
    data: Buffer | Uint8Array | ArrayBuffer | string,
    options?: Record<string, unknown>
  ): Promise<PdfParseResult>;
}
