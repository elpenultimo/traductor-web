import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';

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

function isRelativeUrl(value: string): boolean {
  if (value.startsWith('//')) {
    return true;
  }

  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function absolutizeUrl(value: string, originUrl: URL): string {
  const trimmed = value.trim();
  if (!trimmed || !isRelativeUrl(trimmed)) {
    return value;
  }

  return new URL(trimmed, originUrl).toString();
}

function absolutizeSrcset(value: string, originUrl: URL): string {
  return value
    .split(',')
    .map((candidate) => {
      const part = candidate.trim();
      if (!part) {
        return part;
      }

      const [urlPart, ...descriptorParts] = part.split(/\s+/);
      const absoluteUrl = isRelativeUrl(urlPart) ? new URL(urlPart, originUrl).toString() : urlPart;
      return [absoluteUrl, ...descriptorParts].join(' ').trim();
    })
    .join(', ');
}

function rewriteNavigationLink(href: string, originUrl: URL, lang: string): string {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return href;
  }

  let absolute: URL;
  if (isRelativeUrl(trimmed)) {
    absolute = new URL(trimmed, originUrl);
  } else {
    absolute = new URL(trimmed);
  }

  if (!['http:', 'https:'].includes(absolute.protocol)) {
    return href;
  }

  return `/${lang}?url=${encodeURIComponent(absolute.toString())}`;
}

function ensureBaseTag($: ReturnType<typeof load>, originUrl: URL): void {
  if ($('head').length === 0) {
    if ($('html').length > 0) {
      $('html').prepend('<head></head>');
    } else {
      $.root().prepend('<html><head></head><body></body></html>');
    }
  }

  const baseHref = originUrl.toString();
  const head = $('head').first();
  const base = head.find('base').first();

  if (base.length > 0) {
    base.attr('href', baseHref);
  } else {
    head.prepend(`<base href="${baseHref}">`);
  }
}

function translateBodyTextNodes($: ReturnType<typeof load>, lang: string): void {
  const blockedTags = new Set(['script', 'style', 'noscript']);

  const walk = (node: AnyNode, blocked: boolean): void => {
    const isTag = node.type === 'tag';
    const nextBlocked = blocked || (isTag && blockedTags.has((node as any).name));

    if (node.type === 'text' && !nextBlocked) {
      const content = node.data;
      if (content.trim().length > 0) {
        node.data = translateText(content, lang);
      }
    }

    const children = (node as any).children as AnyNode[] | undefined;
    if (!children) {
      return;
    }

    children.forEach((child) => walk(child, nextBlocked));
  };

  $('body').each((_, body) => walk(body, false));
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

  ensureBaseTag($, parsedUrl);

  $('img').each((_, node) => {
    const src = ($(node).attr('src') ?? '').trim();
    const dataSrc = ($(node).attr('data-src') ?? '').trim();
    if (dataSrc && (!src || src === 'about:blank')) {
      $(node).attr('src', dataSrc);
      $(node).removeAttr('data-src');
    }

    const srcset = ($(node).attr('srcset') ?? '').trim();
    const dataSrcset = ($(node).attr('data-srcset') ?? '').trim();
    if (dataSrcset && !srcset) {
      $(node).attr('srcset', dataSrcset);
    }
  });

  $('img[src], link[href], script[src]').each((_, node) => {
    const attr = node.tagName === 'link' ? 'href' : 'src';
    const value = $(node).attr(attr);
    if (!value) {
      return;
    }

    $(node).attr(attr, absolutizeUrl(value, parsedUrl));
  });

  $('img[srcset], source[srcset]').each((_, node) => {
    const value = $(node).attr('srcset');
    if (!value) {
      return;
    }

    $(node).attr('srcset', absolutizeSrcset(value, parsedUrl));
  });

  $('a[href]').each((_, node) => {
    const href = $(node).attr('href');
    if (!href) {
      return;
    }
    $(node).attr('href', rewriteNavigationLink(href, parsedUrl, lang));
  });

  translateBodyTextNodes($, lang);

  return new Response($.html(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}
