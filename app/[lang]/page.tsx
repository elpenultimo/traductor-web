'use client';

import Link from 'next/link';
import { notFound, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const ALLOWED_LANGS = new Set(['es']);

type LangPageProps = {
  params: { lang: string };
};

export default function LangPage({ params }: LangPageProps) {
  const { lang } = params;
  const searchParams = useSearchParams();
  const rawUrl = searchParams.get('url');

  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  if (!ALLOWED_LANGS.has(lang) || !rawUrl) {
    notFound();
  }

  const apiUrl = useMemo(
    () => `/api/translate?lang=${encodeURIComponent(lang)}&url=${encodeURIComponent(rawUrl)}`,
    [lang, rawUrl]
  );

  useEffect(() => {
    let cancelled = false;

    const loadTranslatedHtml = async () => {
      setError('');
      setHtml('');

      const response = await fetch(apiUrl);
      const content = await response.text();

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setError(content || 'No se pudo traducir la URL.');
        return;
      }

      setHtml(content);
    };

    void loadTranslatedHtml();

    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  return (
    <main>
      <h1>Vista traducida ({lang.toUpperCase()})</h1>
      <p>
        <Link href="/">← Volver</Link>
      </p>
      <small>Origen: {rawUrl}</small>

      {error ? <p>{error}</p> : null}
      {!error && !html ? <p>Cargando traducción…</p> : null}
      {html ? <article className="translated-page" dangerouslySetInnerHTML={{ __html: html }} /> : null}
    </main>
  );
}
