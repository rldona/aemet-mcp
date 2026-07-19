# 0004 — Cliente de dos pasos + decodificación latin1

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

La API de AEMET tiene dos rarezas que rompen el enfoque ingenuo:

1. La primera respuesta **no** trae datos, sino un sobre `{ estado, datos: url }`;
   los datos están en un segundo GET a esa URL.
2. Los ficheros de datos —y las **descripciones de los sobres de error**— vienen en
   **ISO-8859-1 (latin1)**, no UTF-8.

Un cliente que haga un solo GET o que asuma UTF-8 devolverá basura o acentos rotos.

## Decisión

Centralizar ambos saltos y la decodificación en un `AemetClient`:

- `fetchJson(path)` hace el sobre → valida `estado` → segundo GET → decodifica
  **latin1** → `JSON.parse`.
- `fetchDatosBytes(path)` expone los bytes crudos del segundo salto (para avisos).
- El **sobre** también se decodifica en latin1 antes de parsear, para que los
  mensajes de error con acentos (p. ej. el 429 "límites") salgan bien.
- El `estado` se lee del sobre o, si no hay, del status HTTP.

## Consecuencias

- ➕ Las herramientas no conocen la mecánica de AEMET: piden datos tipados.
- ➕ Acentos correctos en datos y en mensajes de error.
- ➕ Un único sitio donde mapear estados y aplicar caché/reintentos.
- ➖ Dos peticiones por consulta (mitigado con caché por `path`).

## Alternativas consideradas

- Decodificar todo como UTF-8: produce mojibake (`l�mites`), descartado.
- Hacer los dos saltos en cada herramienta: duplicación y riesgo de inconsistencia.
