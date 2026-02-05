# Traductor Web (Next.js + TypeScript)

Proyecto web con **Next.js App Router** pensado para desplegarse en **Vercel**.

## Requisitos

- Node.js 18+
- npm 9+

## Ejecutar en local

```bash
npm install
npm run dev
```

Luego abre `http://localhost:3000`.

## Deploy en Vercel

1. Sube este repositorio a GitHub (`traductor-web`).
2. Entra a [vercel.com](https://vercel.com), crea un nuevo proyecto y selecciona el repo.
3. Mantén la configuración por defecto para Next.js.
4. Ejecuta Deploy.

## Notas de seguridad y funcionamiento

- El endpoint `/api/translate` solo acepta URLs `http/https`.
- Se bloquea `localhost` y redes privadas (mitigación SSRF básica).
- Se aplica timeout de 8 segundos y tamaño máximo de 2MB para el HTML de origen.
- Solo se traduce texto visible en etiquetas: `p`, `h1-h6`, `li`, `span`, `a`.
- Scripts y estilos no se traducen.
- La traducción usa un **stub** (`translateText`) que antepone `[ES]`, `[PT]` o `[FR]`.

## Aviso legal

La traducción es automática y puede contener errores. El contenido original pertenece a su fuente/autores originales.
