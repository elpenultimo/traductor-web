import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { rewriteSrcset, toAbsoluteUrl, toNavUrl, toProxyUrl } from '../../../lib/url';

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
const TRANSLATION_BATCH_SIZE = 30;

type TextNode = AnyNode & { data: string };

type DeepLTranslationResponse = {
  translations?: Array<{ text?: string }>;
  message?: string;
};

type ReaderDocument = {
  title: string;
  contentHtml: string;
};

const PLACEHOLDER_DATA_URI_PREFIXES = [
  'data:,',
  'data:image/gif;base64,r0lgodlh',
  'data:image/svg+xml;base64,phn2zyb4bww+'
];

const ALLOWED_READER_TAGS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'main',
  'mark',
  'ol',
  'p',
  'picture',
  'pre',
  'q',
  's',
  'section',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul'
]);

const ALLOWED_READER_ATTRS = new Set([
  'alt',
  'cite',
  'colspan',
  'datetime',
  'decoding',
  'height',
  'href',
  'loading',
  'rowspan',
  'sizes',
  'src',
  'srcset',
  'scope',
  'target',
  'title',
  'width',
  'rel'
]);

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

function isLikelyUrlText(text: string): boolean {
  return /^(https?:\/\/|www\.|mailto:|tel:|ftp:\/\/)/i.test(text);
}

function splitOuterWhitespace(value: string): { leading: string; core: string; trailing: string } {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return {
    leading,
    core: value.slice(leading.length, value.length - trailing.length),
    trailing
  };
}

async function translateText(text: string): Promise<string> {
  const authKey = process.env.DEEPL_AUTH_KEY;
  if (!authKey) {
    throw new Error('DEEPL_AUTH_KEY no está configurada en el entorno.');
  }

  const endpoint = authKey.includes(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
  const body = new URLSearchParams({
    text,
    target_lang: 'ES'
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    let detail = `DeepL devolvió ${response.status}`;
    try {
      const payload = (await response.json()) as DeepLTranslationResponse;
      if (payload?.message) {
        detail = `${detail}: ${payload.message}`;
      }
    } catch {
      // noop: mantener detalle básico si no llega JSON.
    }
    throw new Error(detail);
  }

  const payload = (await response.json()) as DeepLTranslationResponse;
  const translatedText = payload.translations?.[0]?.text;

  if (!translatedText) {
    throw new Error('DeepL devolvió una respuesta sin texto traducido.');
  }

  return translatedText;
}

async function translateBatch(texts: string[]): Promise<string[]> {
  if (texts.length === 1) {
    return [await translateText(texts[0])];
  }

  const authKey = process.env.DEEPL_AUTH_KEY;
  if (!authKey) {
    throw new Error('DEEPL_AUTH_KEY no está configurada en el entorno.');
  }

  const endpoint = authKey.includes(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
  const body = new URLSearchParams({
    target_lang: 'ES'
  });
  texts.forEach((text) => body.append('text', text));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    let detail = `DeepL devolvió ${response.status}`;
    try {
      const payload = (await response.json()) as DeepLTranslationResponse;
      if (payload?.message) {
        detail = `${detail}: ${payload.message}`;
      }
    } catch {
      // noop
    }
    throw new Error(detail);
  }

  const payload = (await response.json()) as DeepLTranslationResponse;
  const translated = payload.translations?.map((entry) => entry.text ?? '');
  if (!translated || translated.length !== texts.length) {
    throw new Error('DeepL devolvió una cantidad inesperada de traducciones.');
  }

  return translated;
}

function rewriteNavigationLink(href: string, originUrl: URL): string {
  const trimmed = href.trim();
  const normalized = trimmed.toLowerCase();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:') ||
    normalized.startsWith('javascript:')
  ) {
    return href;
  }

  const absolute = toAbsoluteUrl(originUrl, trimmed);
  if (!absolute) {
    return href;
  }

  return toNavUrl(absolute);
}

async function translateTextNodes($: ReturnType<typeof load>, selector: string): Promise<void> {
  const blockedTags = new Set(['script', 'style', 'noscript', 'code', 'pre', 'kbd', 'samp']);
  const candidates: Array<{ node: TextNode; leading: string; trailing: string; text: string }> = [];

  const walk = (node: AnyNode, blocked: boolean): void => {
    const isTag = node.type === 'tag';
    const nextBlocked = blocked || (isTag && blockedTags.has((node as { name?: string }).name ?? ''));

    if (node.type === 'text' && !nextBlocked) {
      const content = node.data;
      if (content.trim().length > 0) {
        const { leading, core, trailing } = splitOuterWhitespace(content);
        if (core && !isLikelyUrlText(core)) {
          candidates.push({ node: node as TextNode, leading, trailing, text: core });
        }
      }
    }

    const children = (node as { children?: AnyNode[] }).children;
    if (!children) {
      return;
    }

    children.forEach((child) => walk(child, nextBlocked));
  };

  $(selector).each((_, root) => walk(root, false));

  for (let i = 0; i < candidates.length; i += TRANSLATION_BATCH_SIZE) {
    const batch = candidates.slice(i, i + TRANSLATION_BATCH_SIZE);
    const translatedBatch = await translateBatch(batch.map((entry) => entry.text));

    batch.forEach((entry, index) => {
      const translated = translatedBatch[index]?.trim();
      if (!translated) {
        return;
      }
      entry.node.data = `${entry.leading}${translated}${entry.trailing}`;
    });
  }
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

function sanitizeReaderHtml(contentHtml: string): string {
  const $ = load(`<article>${contentHtml}</article>`);
  $('script,style,iframe,object,embed,form,button,input,textarea,select,link,meta,base').remove();

  $('*').each((_, node) => {
    const tagName = ((node as { name?: string }).name ?? '').toLowerCase();
    if (tagName && !ALLOWED_READER_TAGS.has(tagName)) {
      $(node).replaceWith($(node).contents());
    }
  });

  $('*').each((_, node) => {
    const attrs = Object.keys((node as { attribs?: Record<string, string> }).attribs ?? {});
    attrs.forEach((attr) => {
      const value = ($(node).attr(attr) ?? '').trim();
      const normalizedAttr = attr.toLowerCase();
      if (normalizedAttr.startsWith('on')) {
        $(node).removeAttr(attr);
        return;
      }

      if (!ALLOWED_READER_ATTRS.has(normalizedAttr)) {
        $(node).removeAttr(attr);
        return;
      }

      if (
        (normalizedAttr === 'href' || normalizedAttr === 'src' || normalizedAttr === 'xlink:href') &&
        value.toLowerCase().startsWith('javascript:')
      ) {
        $(node).removeAttr(attr);
      }
    });
  });

  return $('article').html() ?? '';
}

function isPlaceholderMediaValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === '#' || normalized === 'about:blank') {
    return true;
  }

  if (normalized.startsWith('javascript:')) {
    return true;
  }

  return PLACEHOLDER_DATA_URI_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function promoteLazyMediaAttrs($: ReturnType<typeof load>): void {
  $('img, source').each((_, node) => {
    const currentSrc = ($(node).attr('src') ?? '').trim();
    const currentSrcset = ($(node).attr('srcset') ?? '').trim();
    const dataSrc = ($(node).attr('data-src') ?? '').trim();
    const dataSrcset = ($(node).attr('data-srcset') ?? '').trim();

    if (dataSrc && isPlaceholderMediaValue(currentSrc)) {
      $(node).attr('src', dataSrc);
    }

    if (dataSrcset && isPlaceholderMediaValue(currentSrcset)) {
      $(node).attr('srcset', dataSrcset);
    }
  });
}

function extractReaderDocument(sourceHtml: string, originUrl: URL): ReaderDocument {
  const $ = load(sourceHtml);
  const fallbackTitle = $('title').first().text().trim() || originUrl.hostname;

  const candidateSelectors = [
    'article',
    'main article',
    '[role="main"] article',
    'main',
    '[role="main"]',
    '.post-content',
    '.entry-content',
    '.article-content',
    '#content'
  ];

  let bestHtml = '';
  let bestScore = 0;

  candidateSelectors.forEach((selector) => {
    $(selector).each((_, node) => {
      const element = $(node);
      const textLength = element.text().replace(/\s+/g, ' ').trim().length;
      if (textLength > bestScore) {
        bestScore = textLength;
        bestHtml = element.html() ?? '';
      }
    });
  });

  if (!bestHtml) {
    const body = $('body').clone();
    body.find('nav,aside,footer,header,script,style,noscript,form').remove();

    const paragraphs = body
      .find('p')
      .toArray()
      .map((node) => $(node).text().replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 50);

    if (paragraphs.length > 0) {
      bestHtml = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('');
    }
  }

  if (!bestHtml) {
    const bodyText =
      $('body')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 15000) || 'No se pudo extraer contenido legible.';

    bestHtml = `<p>${bodyText}</p>`;
  }

  return {
    title: fallbackTitle,
    contentHtml: bestHtml
  };
}

function rewriteAssetUrl($: ReturnType<typeof load>, selector: string, attr: string, baseUrl: URL): void {
  $(selector).each((_, node) => {
    const current = ($(node).attr(attr) ?? '').trim();
    if (!current) {
      return;
    }

    const absolute = toAbsoluteUrl(baseUrl, current);
    if (!absolute) {
      return;
    }

    $(node).attr(attr, toProxyUrl(absolute));
  });
}

export async function GET(request: Request) {
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

  let sourceHtml: string;
  try {
    sourceHtml = await fetchHtmlWithLimits(parsedUrl);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Error al descargar HTML.', { status: 502 });
  }

  const readerDocument = extractReaderDocument(sourceHtml, parsedUrl);
  const $ = load(`<article>${readerDocument.contentHtml}</article>`);

  promoteLazyMediaAttrs($);

  rewriteAssetUrl($, 'img[src]', 'src', parsedUrl);
  rewriteAssetUrl($, 'source[src]', 'src', parsedUrl);
  rewriteAssetUrl($, 'video[poster]', 'poster', parsedUrl);
  rewriteAssetUrl($, 'audio[src]', 'src', parsedUrl);

  $('img[srcset], source[srcset]').each((_, node) => {
    const value = $(node).attr('srcset');
    if (!value) {
      return;
    }

    $(node).attr('srcset', rewriteSrcset(parsedUrl, value));
  });

  $('a[href]').each((_, node) => {
    const href = $(node).attr('href');
    if (!href) {
      return;
    }

    $(node).attr('href', rewriteNavigationLink(href, parsedUrl));
  });

  try {
    await translateTextNodes($, 'article');
    readerDocument.title = await translateText(readerDocument.title);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error traduciendo con DeepL.';
    const status = message.includes('DEEPL_AUTH_KEY') ? 500 : 502;
    return new Response(message, { status });
  }

  const payload = {
    title: readerDocument.title,
    sourceUrl: parsedUrl.toString(),
    contentHtml: sanitizeReaderHtml($('article').html() ?? '')
  };

  return Response.json(payload);
}
