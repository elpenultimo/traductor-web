'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type TranslatedClientProps = {
  rawUrl: string;
};

type ReaderTranslation = {
  title: string;
  sourceUrl: string;
  contentHtml: string;
};

export default function TranslatedClient({ rawUrl }: TranslatedClientProps) {
  const [readerData, setReaderData] = useState<ReaderTranslation | null>(null);
  const [error, setError] = useState('');

  const apiUrl = useMemo(() => `/api/translate?url=${encodeURIComponent(rawUrl)}`, [rawUrl]);

  useEffect(() => {
    let cancelled = false;

    const loadTranslatedHtml = async () => {
      setError('');
      setReaderData(null);

      const response = await fetch(apiUrl);
      const content = await response.text();

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setError(content || 'No se pudo traducir la URL.');
        return;
      }

      try {
        setReaderData(JSON.parse(content) as ReaderTranslation);
      } catch {
        setError('La respuesta de traducción no tuvo un formato válido.');
      }
    };

    void loadTranslatedHtml();

    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  return (
    <main>
      <p>
        <Link href="/">← Volver</Link>
      </p>

      {error ? <p>{error}</p> : null}
      {!error && !readerData ? <p>Cargando traducción…</p> : null}

      {readerData ? (
        <article className="translated-page">
          <header className="reader-header">
            <h1>{readerData.title}</h1>
            <p>
              Origen:{' '}
              <a href={readerData.sourceUrl} target="_blank" rel="noreferrer noopener">
                {readerData.sourceUrl}
              </a>
            </p>
          </header>
          <section className="reader-content" dangerouslySetInnerHTML={{ __html: readerData.contentHtml }} />
        </article>
      ) : null}
    </main>
  );
}
