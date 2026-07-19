# 0005 — Caché en memoria con TTL

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

La API gratuita de AEMET tiene límites de uso. Las predicciones y observaciones no
cambian a cada segundo, y un asistente puede repetir la misma consulta varias veces
en poco tiempo. Conviene no golpear la API innecesariamente.

## Decisión

Implementar una **caché en memoria con TTL** (`TtlCache`): un `Map` con `value` y
`expiresAt`. TTL por dominio de dato:

- Predicción y avisos: ~10 min.
- Observación: ~5 min.
- Inventario de estaciones: 24 h (cambia rara vez).

Detalles: los **errores no se cachean** (una factory que lanza no crea entrada), y
el reloj es inyectable para tests. La caché es por proceso.

## Consecuencias

- ➕ Menos peticiones y menor probabilidad de topar con el `429`.
- ➕ Respuestas repetidas instantáneas dentro del TTL.
- ➕ Sin dependencias ni estado externo.
- ➖ Al ser por proceso, no se comparte entre ejecuciones (aceptable: el servidor
  stdio es de vida corta y arranca por sesión de cliente).
- ➖ Los datos pueden estar hasta TTL desactualizados (aceptable para meteorología).

## Alternativas consideradas

- **Sin caché**: más llamadas y más riesgo de `429`.
- **Caché en disco / Redis**: sobredimensionado para un proceso local efímero y
  contradice [ADR-0002](./0002-sin-dependencias-pesadas.md).
