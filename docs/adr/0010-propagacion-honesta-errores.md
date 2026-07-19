# 0010 — Propagación honesta de errores (sin mocks)

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

El proyecto se presenta como evidencia real y verificable. Una tentación habitual
al envolver una API inestable es "suavizar" los fallos: devolver datos por defecto,
respuestas vacías o valores mockeados cuando el upstream falla. Eso engañaría al
usuario (y al modelo) haciéndoles creer que tienen datos cuando no.

## Decisión

**No mockear datos en producción ni ocultar errores.** Si un endpoint de AEMET
falla, el error se propaga de forma clara:

- Cada fallo se traduce a un `AemetError` tipado con un mensaje legible.
- Las herramientas devuelven ese mensaje marcado como error (`isError: true`), sin
  inventar un resultado.
- Los únicos datos "estáticos" son el dataset del INE y la tabla de códigos de
  área, ambos **verificados contra fuentes oficiales** (no inventados).
- Los mocks existen **solo en los tests** (`fetch` inyectado), nunca en el camino
  de ejecución real.

## Consecuencias

- ➕ El usuario siempre sabe si un dato es real o si AEMET falló.
- ➕ Coherente con el uso del proyecto como pieza de portfolio verificable.
- ➕ Facilita depurar: los mensajes distinguen 401 vs 404 vs 429 vs red.
- ➖ El usuario ve errores "crudos" de AEMET cuando los hay (es intencionado: mejor
  un error honesto que un dato falso).

## Alternativas consideradas

- Devolver valores por defecto ante fallo: descartado por deshonesto y peligroso
  (decisiones basadas en datos inexistentes).
- Silenciar errores y devolver vacío: oculta el problema y confunde al modelo.
