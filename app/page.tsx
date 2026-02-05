'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const LANGS = [
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'fr', label: 'Français' }
] as const;

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState('https://example.com');
  const [lang, setLang] = useState<(typeof LANGS)[number]['value']>('es');
  const [copyState, setCopyState] = useState('');

  const translatedPath = useMemo(() => `/${lang}?url=${encodeURIComponent(url)}`, [lang, url]);

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
      <p>Pega una URL para traducir su contenido visible.</p>

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
          <select value={lang} onChange={(event) => setLang(event.target.value as 'es' | 'pt' | 'fr')}>
            {LANGS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
