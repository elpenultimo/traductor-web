import { notFound } from 'next/navigation';
import TranslatedClient from './translated-client';

type TranslatedPageProps = {
  searchParams: {
    url?: string;
  };
};

export default function TranslatedPage({ searchParams }: TranslatedPageProps) {
  const rawUrl = searchParams.url;

  if (!rawUrl) {
    notFound();
  }

  return <TranslatedClient rawUrl={rawUrl} />;
}
