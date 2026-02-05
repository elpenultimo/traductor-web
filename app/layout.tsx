import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Traductor Web',
  description: 'Traduce contenido web vía proxy y conserva navegación traducida.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
