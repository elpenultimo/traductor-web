'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState('https://example.com');
  const [copyState, setCopyState] = useState('');

  const translatedPath = useMemo(() => `/traducido?url=${encodeURIComponent(url)}`, [url]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(translatedPath);
  };

  const onCopy = async () => {
    const absoluteLink = `${window.location.origin}${translatedPath}`;
    try {
      await navigator.clipboard.writeText(absoluteLink);
      setCopyState('Enlace copiado al portapapeles.');
    } catch {
      setCopyState('No se pudo copiar el enlace.');
    }
  };

  return (
    <main>
      <h1>Traductor Web</h1>
      <p>Pega una URL y tradúcela al español.</p>

      <form className="card" onSubmit={onSubmit}>
        <div className="row">
          <input
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://sitio.com"
            aria-label="URL a traducir"
          />
          <button type="submit">Traducir</button>
          <button type="button" className="secondary" onClick={onCopy}>
            Copiar enlace traducido
          </button>
        </div>
        {copyState ? <p>{copyState}</p> : null}
      </form>
    </main>
  );
}
