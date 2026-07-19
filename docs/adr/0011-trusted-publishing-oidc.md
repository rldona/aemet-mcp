# 0011 — Publicación con Trusted Publishing (OIDC)

- **Estado**: Aceptada
- **Fecha**: 2026-07-19
- **Relacionada con**: [ADR-0009](./0009-nombre-paquete-scoped.md)

## Contexto

El primer publish (v0.1.0) se hizo con un token de npm, y fue tortuoso: npm está
**restringiendo los tokens que saltan el 2FA para publicación directa**. En la
práctica, publicar con token dejó el paquete en **staging** (retenido), obligando a
confirmarlo a mano en la web. Para las siguientes versiones queremos una
publicación **directa, reproducible y sin secretos** de larga vida.

## Decisión

Adoptar **Trusted Publishing (OIDC)** desde GitHub Actions:

- El workflow declara `permissions: id-token: write`. GitHub emite un token OIDC de
  corta vida que identifica repo + workflow.
- npm (≥ 11.5.1) verifica ese token contra el **Trusted Publisher** configurado en
  el paquete (repo `rldona/aemet-mcp`, workflow `publish.yml`) y autoriza la
  publicación **sin `NODE_AUTH_TOKEN`**.
- `npm publish` genera **provenance automáticamente** y publica **directo** (sin
  staging).
- Se elimina la dependencia del secret `NPM_TOKEN`.

Configuración de una sola vez en npmjs.com (página del paquete → Settings →
Trusted Publisher): GitHub Actions, org/usuario `rldona`, repo `aemet-mcp`,
workflow `publish.yml`.

## Consecuencias

- ➕ Sin tokens de larga vida en GitHub: menor superficie y nada que rotar.
- ➕ Publicación directa (sin staging manual) y con provenance verificable.
- ➕ El derecho a publicar está atado a un repo/workflow concretos, no a un secreto
  que se pueda filtrar.
- ➖ Requiere que el paquete **ya exista** para configurar el Trusted Publisher, por
  lo que el **primer** publish tuvo que hacerse con token (ver [ADR-0009]).
- ➖ Hay que mantener npm actualizado en CI (Node trae una versión anterior a la que
  soporta OIDC; el workflow hace `npm install -g npm@latest`).

## Alternativas consideradas

- **Seguir con `NPM_TOKEN` (Automation)**: npm los está restringiendo y provocan
  staging; peor DX y un secreto que rotar.
- **Publicar siempre en local con OTP**: manual, no reproducible y depende de tener
  el authenticator a mano.
