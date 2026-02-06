import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';

export type RelevantLink = {
  title: string;
  url: string;
};

const EXCLUDED_TOKENS = [
  'login',
  'suscrib',
  'facebook',
  'twitter',
  'instagram',
  'share',
  'whatsapp',
  'terms',
  'privacy',
  'cookies'
];

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isSameSiteHost(candidateHost: string, sourceHost: string): boolean {
  const normalizedCandidate = normalizeHost(candidateHost);
  const normalizedSource = normalizeHost(sourceHost);

  return (
    normalizedCandidate === normalizedSource ||
    normalizedCandidate.endsWith(`.${normalizedSource}`) ||
    normalizedSource.endsWith(`.${normalizedCandidate}`)
  );
}

function hasExcludedToken(text: string): boolean {
  const normalized = text.toLowerCase();
  return EXCLUDED_TOKENS.some((token) => normalized.includes(token));
}

function computeScore($: ReturnType<typeof load>, anchor: AnyNode, title: string): number {
  const lengthScore = Math.min(title.length, 180);
  const titleCaseBonus = /[A-ZÁÉÍÓÚÑ][^.!?]{20,}/.test(title) ? 25 : 0;

  let contextBonus = 0;
  if ($(anchor).closest('article').length > 0) contextBonus += 45;
  if ($(anchor).closest('main').length > 0) contextBonus += 35;
  if ($(anchor).closest('h1,h2,h3').length > 0) contextBonus += 50;
  if ($(anchor).closest('#content,.content,.article').length > 0) contextBonus += 40;

  return lengthScore + titleCaseBonus + contextBonus;
}

export function extractRelevantLinks(html: string, baseUrl: URL): RelevantLink[] {
  const $ = load(html);
  const byUrl = new Map<string, { title: string; score: number }>();

  $('a[href]').each((_, node) => {
    const rawHref = ($(node).attr('href') ?? '').trim();
    if (!rawHref || rawHref === '#' || rawHref.startsWith('#')) {
      return;
    }

    const normalizedHref = rawHref.toLowerCase();
    if (
      normalizedHref.startsWith('mailto:') ||
      normalizedHref.startsWith('tel:') ||
      normalizedHref.startsWith('javascript:')
    ) {
      return;
    }

    let absolute: URL;
    try {
      absolute = new URL(rawHref, baseUrl);
    } catch {
      return;
    }

    if (!['http:', 'https:'].includes(absolute.protocol)) {
      return;
    }

    if (!isSameSiteHost(absolute.hostname, baseUrl.hostname)) {
      return;
    }

    const title = $(node).text().replace(/\s+/g, ' ').trim();
    if (title.length < 25 || hasExcludedToken(title) || hasExcludedToken(absolute.toString())) {
      return;
    }

    const normalizedUrl = absolute.toString();
    const score = computeScore($, node, title);
    const existing = byUrl.get(normalizedUrl);

    if (!existing || score > existing.score) {
      byUrl.set(normalizedUrl, { title, score });
    }
  });

  return Array.from(byUrl.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 15)
    .map(([url, data]) => ({ title: data.title, url }));
}
