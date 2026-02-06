import { extractPdfTextFromUrl } from '../../../lib/pdf';

const PRIVATE_IPV4_RANGES = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[0-1])\./, /^169\.254\./, /^0\./];
const PRIVATE_HOSTS = new Set(['localhost', '::1', '[::1]']);

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(normalized)) {
    return true;
  }

  return PRIVATE_IPV4_RANGES.some((range) => range.test(normalized));
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');

  if (!rawUrl) {
    return new Response('Parámetros inválidos.', { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return new Response('URL inválida.', { status: 400 });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return new Response('Solo se permiten URLs http/https.', { status: 400 });
  }

  if (isPrivateHost(parsedUrl.hostname)) {
    return new Response('Host bloqueado por seguridad.', { status: 403 });
  }

  try {
    const payload = await extractPdfTextFromUrl(parsedUrl);
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al extraer texto del PDF.';
    return new Response(message, { status: 502 });
  }
}
