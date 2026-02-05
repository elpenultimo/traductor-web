import { toAbsoluteUrl, toProxyUrl } from '../../../lib/url';

const PRIVATE_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./
];
const PRIVATE_HOSTS = new Set(['localhost', '::1', '[::1]']);
const PRIVATE_IPV6_PATTERNS = [/^fc/i, /^fd/i, /^fe[89ab]/i];
const ALLOWED_HOST_PATTERNS = [/\.wikipedia\.org$/i, /\.wikimedia\.org$/i, /\.bbc\.com$/i];
const ALLOWED_HOSTS = new Set(['example.com']);

function isBlockedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(normalized)) {
    return true;
  }

  if (PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const compact = normalized.replace(/[[\]]/g, '').replace(/:/g, '');
  return PRIVATE_IPV6_PATTERNS.some((pattern) => pattern.test(compact));
}

function isAllowedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(normalized)) {
    return true;
  }

  return ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
}

function rewriteCssUrls(css: string, cssUrl: URL): string {
  const rewriteRef = (rawRef: string): string => {
    const cleaned = rawRef.trim().replace(/^['"]|['"]$/g, '');
    const abs = toAbsoluteUrl(cssUrl, cleaned);
    if (!abs) {
      return rawRef;
    }
    return `'${toProxyUrl(abs)}'`;
  };

  const withUrl = css.replace(/url\(([^)]+)\)/gi, (full, ref) => {
    const trimmed = String(ref).trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) {
      return full;
    }
    return `url(${rewriteRef(trimmed)})`;
  });

  return withUrl.replace(/@import\s+(url\(([^)]+)\)|(['"])(.*?)\3)/gi, (full, _group, urlInUrl, quote, quotedRef) => {
    const ref = (urlInUrl ?? quotedRef ?? '').trim();
    if (!ref) {
      return full;
    }

    const abs = toAbsoluteUrl(cssUrl, ref);
    if (!abs) {
      return full;
    }

    const proxied = toProxyUrl(abs);
    return `@import url('${proxied}')`;
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');

  if (!rawUrl) {
    return new Response('Falta el parámetro url.', { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return new Response('URL inválida.', { status: 400 });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return new Response('Solo se permiten URLs http/https.', { status: 400 });
  }

  if (isBlockedHost(parsed.hostname)) {
    return new Response('Host bloqueado por seguridad.', { status: 403 });
  }

  if (!isAllowedHost(parsed.hostname)) {
    return new Response('Host no permitido. /api/proxy solo permite hosts en allowlist.', { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'traductor-web-proxy/1.0 (+https://localhost)',
        Accept: 'text/css,text/html,application/javascript,image/*,*/*;q=0.8'
      }
    });
  } catch {
    return new Response('No se pudo descargar el recurso remoto.', { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(`Error remoto: ${upstream.status}`, { status: upstream.status });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  if (contentType.toLowerCase().includes('text/css')) {
    const cssText = await upstream.text();
    const rewritten = rewriteCssUrls(cssText, parsed);
    return new Response(rewritten, {
      status: upstream.status,
      headers
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}
