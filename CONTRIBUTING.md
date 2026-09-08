# Guía de contribución

¡Gracias por tu interés en aemet-mcp! Esta guía cubre cómo montar el entorno,
el estilo de código y el proceso para contribuir.

## Requisitos

- Node.js ≥ 18
- Una API key de AEMET OpenData **solo** si quieres correr los tests de integración
  (los unitarios no la necesitan).

## Montar el entorno

```bash
git clone https://github.com/rldona/aemet-mcp.git
cd aemet-mcp
npm install
```

## Scripts

| Comando | Qué hace |
|---------|----------|
| `npm test` | Tests unitarios (fetch mockeado; sin API key). |
| `npm run test:watch` | Tests en modo watch. |
| `npm run typecheck` | Comprobación de tipos (TS strict). |
| `npm run build` | Empaqueta a `dist/` con tsup. |
| `npm run audit:prod` | Auditoría de dependencias de producción (lo mismo que CI). |
| `npm run dataset:generate` | Regenera `municipios.json` desde el último diccionario del INE. |
| `npm run dataset:check` | Valida el dataset; con un JSON anterior como argumento, muestra el diff. |
| `npm run test:pack` | Empaqueta con `npm pack`, instala el tarball en un proyecto limpio y valida resolución ESM/CJS, tipos, binario y arranque MCP. |
| `npm run inspector` | Abre el MCP Inspector contra el servidor (requiere key). |

Test de integración real (opcional):

```bash
AEMET_API_KEY=xxx npx vitest run test/integration.aemet.test.ts
```

## Estilo de código

- **TypeScript strict**; sin `any` salvo justificación.
- Sin nuevas dependencias de runtime salvo discusión previa
  (ver [ADR-0002](./docs/adr/0002-sin-dependencias-pesadas.md)).
- Comentarios y mensajes de usuario **en español** (el proyecto es es-ES).
- Errores hacia el usuario: claros y honestos, nunca datos inventados
  (ver [ADR-0010](./docs/adr/0010-propagacion-honesta-errores.md)).

## Antes de abrir un PR

1. `npm run typecheck` en verde.
2. `npm test` en verde (el build va antes: el smoke test MCP arranca `dist/`).
3. Si tocas `package.json`, `tsup.config.ts` o `src/lib.ts`, además
   `npm run test:pack`: los fallos de packaging no los ve ningún test unitario.
4. Si tocas comportamiento, **añade o ajusta tests**.
5. Si tomas una decisión de arquitectura, añade un ADR en `docs/adr/`.
6. Actualiza el `CHANGELOG.md` (sección "No publicado").

## Mensajes de commit

Se recomienda [Conventional Commits](https://www.conventionalcommits.org/es/):
`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`.

## Regenerar el dataset de municipios

```bash
node scripts/generate-municipios.mjs
```

Descarga el diccionario del INE y regenera `src/data/municipios.json`.

## Publicar (mantenedores)

La publicación la hace CI al crear una Release mediante **Trusted Publishing
(OIDC)**, sin token. Ver la [guía de publicación](./docs/publishing.md) y
[ADR-0011](./docs/adr/0011-trusted-publishing-oidc.md).
