'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type TranslatedClientProps = {
  rawUrl: string;
};

type ReaderTranslation = {
  mode: 'reader';
  title: string;
  sourceUrl: string;
  contentHtml: string;
};

type LinksFallback = {
  mode: 'links';
  sourceUrl: string;
  links: Array<{ title: string; url: string }>;
};

type TranslationResult = ReaderTranslation | LinksFallback;

export default function TranslatedClient({ rawUrl }: TranslatedClientProps) {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [error, setError] = useState('');

  const apiUrl = useMemo(() => `/api/translate?url=${encodeURIComponent(rawUrl)}`, [rawUrl]);

  useEffect(() => {
    let cancelled = false;

    const loadTranslatedHtml = async () => {
      setError('');
      setResult(null);

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
        setResult(JSON.parse(content) as TranslationResult);
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
      {!error && !result ? <p>Cargando traducción…</p> : null}

      {result?.mode === 'reader' ? (
        <article className="translated-page">
          <header className="reader-header">
            <h1>{result.title}</h1>
            <p>
              Origen:{' '}
              <a href={result.sourceUrl} target="_blank" rel="noreferrer noopener">
                {result.sourceUrl}
              </a>
            </p>
          </header>
          <section className="reader-content" dangerouslySetInnerHTML={{ __html: result.contentHtml }} />
        </article>
      ) : null}

      {result?.mode === 'links' ? (
        <section className="translated-page">
          <div className="reader-header">
            <p>
              Esta página parece un visor o contenido no legible en modo lectura. Te dejo enlaces detectados para
              traducir:
            </p>
            <p>
              Origen:{' '}
              <a href={result.sourceUrl} target="_blank" rel="noreferrer noopener">
                {result.sourceUrl}
              </a>
            </p>
          </div>
          {result.links.length === 0 ? <p>No detecté enlaces traducibles en esta página.</p> : null}
          <ul>
            {result.links.map((link) => (
              <li key={link.url}>
                <p>{link.title}</p>
                <p>
                  <a href={link.url} target="_blank" rel="noreferrer noopener">
                    {link.url}
                  </a>
                </p>
                <Link href={`/traducido?url=${encodeURIComponent(link.url)}`}>Traducir</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
