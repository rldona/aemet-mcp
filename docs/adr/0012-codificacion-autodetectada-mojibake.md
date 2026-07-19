# 0012 — Codificación auto-detectada + reparación de mojibake

- **Estado**: Aceptada
- **Fecha**: 2026-07-19
- **Reemplaza a**: [ADR-0004](./0004-cliente-dos-pasos-latin1.md)

## Contexto

El [ADR-0004](./0004-cliente-dos-pasos-latin1.md) asumía que **todos** los ficheros
de datos de AEMET venían en **ISO-8859-1 (latin1)**. En producción (notemojes.com)
resultó **falso**: AEMET mezcla codificaciones según el endpoint y el nodo CDN que
responda. En concreto:

- El maestro/algunos recursos vienen en **latin1**.
- La predicción municipal viene en **UTF-8**.
- Peor: AEMET declara `charset=ISO-8859-15` mientras sirve **bytes UTF-8**, y
  algunos `fetch` intermedios (el fetch parcheado de Next.js, proxies) se creen la
  cabecera y **transcodifican**, produciendo **mojibake doble** (`"AndÃºjar"` en
  vez de `"Andújar"`).

Decodificar siempre en latin1 (como hacía 0004) rompía los acentos en los recursos
UTF-8; decodificar siempre en UTF-8 los rompía en los latin1.

## Decisión

Sustituir el "siempre latin1" por **detección automática + reparación**:

1. **Auto-detección** al decodificar el fichero de `datos`: se intenta
   `TextDecoder("utf-8", { fatal: true })`; si los bytes **no** son UTF-8 válido,
   se cae a `latin1`.
2. **`reparaMojibake(text)`**: detecta el patrón de doble codificación (`Ã` +
   byte de continuación, imposible en español real), reinterpreta los bytes latin1
   como UTF-8 y deshace la transcodificación. Es **idempotente** sobre texto sano.
3. **`reparaProfundo(json)`**: aplica la reparación a cada string del JSON ya
   parseado (cadena a cadena), porque el nodo CDN puede variar entre llamadas.
4. El **sobre** de error se sigue decodificando en **latin1** (sus descripciones lo
   son de forma estable).

`reparaMojibake` y `reparaProfundo` se exportan en la API de librería para que un
backend que consuma AEMET por su cuenta pueda reutilizarlos.

## Consecuencias

- ➕ Acentos correctos en todos los recursos, sea cual sea su codificación o el nodo
  CDN, y aunque un proxy intermedio haya transcodificado.
- ➕ La corrección viaja tanto en el servidor MCP como en la librería (mismo núcleo).
- ➖ Un paso extra de decodificación/reparación por respuesta (coste despreciable;
  la reparación solo actúa si detecta el patrón de mojibake).
- ➖ La heurística es específica del mojibake UTF-8↔latin1; no cubre otras
  codificaciones exóticas (no observadas en AEMET).

## Alternativas consideradas

- **Seguir con "siempre latin1"** ([ADR-0004]): rompía la predicción municipal (UTF-8).
- **Fijar "siempre UTF-8"**: rompía los recursos en latin1.
- **Fiarse del `charset` de la cabecera**: es justamente el dato erróneo que
  provoca el problema.
