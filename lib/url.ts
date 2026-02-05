function hasScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

export function toAbsoluteUrl(base: URL | string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (
    trimmed.startsWith('#') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:') ||
    normalized.startsWith('javascript:')
  ) {
    return null;
  }

  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  if (hasScheme(trimmed) && !trimmed.startsWith('http:') && !trimmed.startsWith('https:')) {
    return null;
  }

  return new URL(trimmed, base).toString();
}

export function toProxyUrl(abs: string): string {
  return `/api/proxy?url=${encodeURIComponent(abs)}`;
}

export function toNavUrl(lang: string, abs: string): string {
  return `/${lang}?url=${encodeURIComponent(abs)}`;
}

export function rewriteSrcset(base: URL | string, srcset: string): string {
  return srcset
    .split(',')
    .map((entry) => {
      const part = entry.trim();
      if (!part) {
        return part;
      }

      const [urlPart, ...descriptors] = part.split(/\s+/);
      const absolute = toAbsoluteUrl(base, urlPart);
      const nextUrl = absolute ? toProxyUrl(absolute) : urlPart;
      return [nextUrl, ...descriptors].join(' ').trim();
    })
    .join(', ');
}
