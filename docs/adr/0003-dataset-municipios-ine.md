# 0003 — Bundlear el dataset de municipios del INE

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

AEMET indexa las predicciones por **código INE de 5 dígitos**, no por nombre. El
usuario habla de "Málaga", no de "29067". Resolver nombre → código en cada consulta
llamando a AEMET gastaría cuota y añadiría latencia y un punto de fallo.

## Decisión

Bundlear un **dataset estático** de municipios (`src/data/municipios.json`,
`{ codigo, nombre }`) generado del **diccionario oficial del INE**
(`scripts/generate-municipios.mjs`, que descarga y parsea el `.xlsx` del INE). El
código INE = `CPRO` (2 díg.) + `CMUN` (3 díg.). Resultado: 8132 municipios.

La resolución es local, con normalización tolerante a acentos/mayúsculas y
desambiguación de nombres repetidos.

## Consecuencias

- ➕ Resolver un nombre **no** consume cuota de AEMET ni añade latencia de red.
- ➕ Fuente autoritativa (INE): los códigos son reales y verificables, no inventados.
- ➕ Funciona sin conexión para la parte de resolución.
- ➖ El dataset envejece si cambian los municipios (raro); se regenera con el script.
- ➖ Suma ~350 kB al bundle (aceptable; es la mayor parte del paquete).

## Alternativas consideradas

- **Maestro de municipios de AEMET** (`/maestro/municipios`): requiere API key y una
  llamada; el INE es igual de válido y sin coste de cuota.
- **Resolver en caliente por API**: descartado por cuota, latencia y dependencia.
