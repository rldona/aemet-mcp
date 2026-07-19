# Architecture Decision Records (ADR)

Registro de las decisiones de arquitectura significativas de aemet-mcp. Cada ADR
documenta el contexto, la decisión tomada y sus consecuencias, siguiendo el
formato de [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## Índice

| # | Título | Estado |
|---|--------|--------|
| [0001](./0001-mcp-stdio-sdk.md) | Protocolo MCP por stdio con el SDK oficial | Aceptada |
| [0002](./0002-sin-dependencias-pesadas.md) | Sin dependencias pesadas | Aceptada |
| [0003](./0003-dataset-municipios-ine.md) | Bundlear el dataset de municipios del INE | Aceptada |
| [0004](./0004-cliente-dos-pasos-latin1.md) | Cliente de dos pasos + decodificación latin1 | Aceptada |
| [0005](./0005-cache-en-memoria-ttl.md) | Caché en memoria con TTL | Aceptada |
| [0006](./0006-reintentos-backoff.md) | Reintentos con backoff (429, red, 5xx) | Aceptada |
| [0007](./0007-avisos-tar-cap-sin-deps.md) | Avisos: parseo de tar.gz + CAP sin dependencias | Aceptada |
| [0008](./0008-codigos-area-avisos.md) | Códigos de área de avisos verificados empíricamente | Aceptada |
| [0009](./0009-nombre-paquete-scoped.md) | Nombre de paquete con scope `@rldona` | Aceptada |
| [0010](./0010-propagacion-honesta-errores.md) | Propagación honesta de errores (sin mocks) | Aceptada |
| [0011](./0011-trusted-publishing-oidc.md) | Publicación con Trusted Publishing (OIDC) | Aceptada |

## Plantilla

Para una decisión nueva, copia esta estructura en `NNNN-titulo-en-kebab.md`:

```markdown
# NNNN — Título

- **Estado**: Propuesta | Aceptada | Rechazada | Reemplazada por [ADR-XXXX]
- **Fecha**: AAAA-MM-DD

## Contexto
Qué problema/fuerza motiva la decisión.

## Decisión
Qué se decide hacer.

## Consecuencias
Positivas, negativas y neutrales derivadas de la decisión.

## Alternativas consideradas
Opciones descartadas y por qué.
```
