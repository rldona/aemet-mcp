# 0006 — Reintentos con backoff (429, red, 5xx)

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

Durante las pruebas contra la API real aparecieron fallos **transitorios**: el
servidor de datos de AEMET cortó una conexión (`fetch failed`) y en otra ocasión
devolvió `HTTP 500`, además del `429` por límite de peticiones. Un fallo puntual no
debería tumbar una consulta si un reintento la resolvería.

## Decisión

Aplicar **reintentos con backoff exponencial** en el `AemetClient`, en ambos saltos:

- `429` (límite): reintenta hasta `maxRetries` (por defecto 3) con backoff
  `base · 2^intento` (base 500 ms). Si persiste → `RATE_LIMITED`.
- **Fallos de red** (fetch lanza): reintenta igual; si se agotan → `NETWORK`.
- **HTTP 5xx** en la descarga de datos: reintenta; si persiste → `UPSTREAM`.

`fetch` y `sleep` son inyectables para poder testear el backoff sin esperas reales.

## Consecuencias

- ➕ Resiliencia ante la flakiness observada del CDN de datos de AEMET.
- ➕ No enmascara fallos persistentes: si tras los reintentos sigue fallando, se
  propaga un error tipado y claro.
- ➖ Una operación que falla de forma persistente tarda más (varios backoffs) antes
  de dar el error final (aceptable y acotado por `maxRetries`).

## Alternativas consideradas

- **Sin reintentos**: una consulta caía por un corte puntual reproducible.
- **Reintentar cualquier código**: se evitó reintentar `401/404` (no son
  transitorios) para no ocultar errores reales ni gastar cuota en balde.
