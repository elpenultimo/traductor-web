import pdfParse from 'pdf-parse';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_TEXT_CHARS = 60_000;

export type PdfExtractionResult = {
  text: string;
  truncated: boolean;
  bytes: number;
};

export function looksLikePdfUrl(url: URL): boolean {
  return /\.pdf$/i.test(url.pathname);
}

export async function isPdfResource(url: URL): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'traductor-web/1.0',
        Accept: 'application/pdf,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      return looksLikePdfUrl(url);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    return contentType.includes('application/pdf');
  } catch {
    return looksLikePdfUrl(url);
  }
}

export async function extractPdfTextFromUrl(url: URL): Promise<PdfExtractionResult> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'traductor-web/1.0',
      Accept: 'application/pdf,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar el PDF: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) {
    throw new Error('El PDF excede 10MB.');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Respuesta vacía al descargar PDF.');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    total += value.byteLength;
    if (total > MAX_PDF_BYTES) {
      throw new Error('El PDF excede 10MB.');
    }

    chunks.push(value);
  }

  const pdfBuffer = Buffer.concat(chunks);
  const extracted = await pdfParse(pdfBuffer);
  const normalizedText = extracted.text.replace(/\r\n/g, '\n').trim();
  const truncated = normalizedText.length > MAX_PDF_TEXT_CHARS;

  return {
    text: truncated ? normalizedText.slice(0, MAX_PDF_TEXT_CHARS) : normalizedText,
    truncated,
    bytes: total
  };
}
