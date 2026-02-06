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

function ensureBaseTag($: ReturnType<typeof load>, appUrl: URL): void {
  if ($('head').length === 0) {
    if ($('html').length > 0) {
      $('html').prepend('<head></head>');
    } else {
      $.root().prepend('<html><head></head><body></body></html>');
    }
  }

  const baseHref = `${appUrl.origin}/`;
  const head = $('head').first();
  const base = head.find('base').first();

  if (base.length > 0) {
    base.attr('href', baseHref);
  } else {
    head.prepend(`<base href="${baseHref}">`);
  }
}

async function translateBodyTextNodes($: ReturnType<typeof load>): Promise<void> {
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

  $('body').each((_, body) => walk(body, false));

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

function rewriteAssetUrl(
  $: ReturnType<typeof load>,
  selector: string,
  attr: string,
  baseUrl: URL,
  shouldRewrite?: (node: AnyNode) => boolean
): void {
  $(selector).each((_, node) => {
    if (shouldRewrite && !shouldRewrite(node)) {
      return;
    }

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

  const $ = load(sourceHtml);

  ensureBaseTag($, new URL(request.url));

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

  // Route asset fetches through /api/proxy.
  rewriteAssetUrl($, 'img[src]', 'src', parsedUrl);
  rewriteAssetUrl($, 'script[src]', 'src', parsedUrl);
  rewriteAssetUrl($, 'link[href]', 'href', parsedUrl, (node) => {
    const rel = ($(node).attr('rel') ?? '').toLowerCase();
    return ['stylesheet', 'icon', 'preload'].some((value) => rel.includes(value));
  });
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
    await translateBodyTextNodes($);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error traduciendo con DeepL.';
    const status = message.includes('DEEPL_AUTH_KEY') ? 500 : 502;
    return new Response(message, { status });
  }

  return new Response($.html(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}
