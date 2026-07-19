# 0008 — Códigos de área de avisos verificados empíricamente

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

Los avisos se piden por `codigoArea` de 2 dígitos, uno por comunidad autónoma. Se
partió de una tabla "intuitiva" (asumiendo un orden lógico de comunidades). Al
probar, `avisos` para "Cantabria" devolvió zonas de **Gran Canaria** — la tabla
estaba mal.

## Decisión

**Verificar cada código contra la API** descargando sus avisos e inspeccionando las
zonas (`areaDesc`) reales, en lugar de fiarse de una tabla asumida. El resultado:
los códigos van en **orden alfabético** de comunidad, con desajustes respecto a lo
esperado:

| Código | Comunidad real |
|--------|----------------|
| 65 | Canarias (¡no Cantabria!) |
| 66 | Cantabria |
| 67 | Castilla y León |
| 68 | Castilla-La Mancha |
| … | … |
| 78 | Ceuta (¡no Canarias!) |

La tabla completa y correcta está en `src/aemet/areas.ts` y en
[aemet-api-notes.md](../aemet-api-notes.md). Hay un test de regresión que fija
`65 = Canarias`, `66 = Cantabria`, `78 = Ceuta`.

## Consecuencias

- ➕ Los avisos corresponden a la comunidad pedida (correctitud).
- ➕ Refuerza la política de **no inventar datos**: se verificó contra la fuente en
  lugar de asumir.
- ➖ La tabla depende de que AEMET no reordene sus códigos (improbable; cubierto por
  el test de regresión y regenerable inspeccionando la API).

## Alternativas consideradas

- Confiar en la tabla asumida: habría enviado a los usuarios avisos de la comunidad
  equivocada. Descartado en cuanto la verificación lo destapó.
