'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type TranslatedClientProps = {
  rawUrl: string;
};

export default function TranslatedClient({ rawUrl }: TranslatedClientProps) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  const apiUrl = useMemo(() => `/api/translate?url=${encodeURIComponent(rawUrl)}`, [rawUrl]);

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
      <h1>Vista traducida (ES)</h1>
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
