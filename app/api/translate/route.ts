import { load } from 'cheerio';

const ALLOWED_LANGS = new Set(['es', 'pt', 'fr']);
const PRIVATE_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^0\./
];
const PRIVATE_HOSTS = new Set(['localhost', '::1', '[::1]']);
const MAX_BYTES = 2 * 1024 * 1024;

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(normalized)) {
    return true;
  }

  if (PRIVATE_IPV4_RANGES.some((range) => range.test(normalized))) {
    return true;
  }

  return false;
}

function translateText(text: string, lang: string): string {
  const prefix =
    lang === 'es' ? '[ES] ' :
    lang === 'pt' ? '[PT] ' :
    '[FR] ';
  return `${prefix}${text}`;
}

function rewriteLink(href: string, originUrl: URL, lang: string): string {
  if (href.startsWith('#')) {
    return href;
  }

  const absolute = new URL(href, originUrl);
  if (!['http:', 'https:'].includes(absolute.protocol)) {
    return href;
  }

  return `/${lang}?url=${encodeURIComponent(absolute.toString())}`;
}

async function fetchHtmlWithLimits(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'traductor-web/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`No se pudo cargar la URL: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Respuesta vacía');
    }

    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_BYTES) {
        throw new Error('El HTML excede 2MB.');
      }

      chunks.push(value);
    }

    return new TextDecoder().decode(Buffer.concat(chunks));
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');
  const lang = searchParams.get('lang') ?? 'es';

  if (!rawUrl || !ALLOWED_LANGS.has(lang)) {
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

  let sourceHtml: string;
  try {
    sourceHtml = await fetchHtmlWithLimits(parsedUrl);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Error al descargar HTML.', { status: 502 });
  }

  const $ = load(sourceHtml);

  $('p, h1, h2, h3, h4, h5, h6, li, span, a').each((_, node) => {
    const text = $(node).text().trim();
    if (text.length > 0) {
      $(node).text(translateText(text, lang));
    }
  });

  $('a[href]').each((_, node) => {
    const href = $(node).attr('href');
    if (!href) {
      return;
    }
    $(node).attr('href', rewriteLink(href, parsedUrl, lang));
  });

  return new Response($.html(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}
