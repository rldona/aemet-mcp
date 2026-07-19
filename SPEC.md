# AEMET MCP — Especificación

Servidor **MCP (Model Context Protocol)** que da a cualquier cliente compatible
(Claude Desktop, Cursor, etc.) acceso al **tiempo oficial de España** vía la API
pública [OpenData de AEMET](https://opendata.aemet.es/). Se instala y arranca con
un único `npx`, sin backend propio.

## Principios (restricción de honestidad)

Este producto se lista como evidencia real y verificable. Por tanto **tiene que
ser cierto** que:

- Implementa el protocolo MCP y se enchufa a Claude/Cursor sin adaptadores.
- Envuelve la API pública de AEMET y expone predicción (y avisos) como
  herramientas tipadas.
- Es publicable en npm y arranca con un solo `npx`, con caché y control de
  errores para no reventar los límites de la API.

**Nada de datos inventados ni respuestas mockeadas en producción.** Si un endpoint
falla, se propaga un error claro.

## Herramientas MCP

| Herramienta            | Entrada                               | Devuelve |
|------------------------|---------------------------------------|----------|
| `buscar_municipio`     | `nombre: string`                      | Coincidencias de municipio con su código INE (resuelve nombre → código). |
| `prediccion_diaria`    | `municipio: string` (nombre o código) | Predicción diaria (varios días): temp. máx/mín, estado del cielo, prob. precipitación, viento. |
| `prediccion_horaria`   | `municipio: string`                   | Predicción hora a hora del día en curso y siguiente. |
| `observacion_estacion` | `estacion?: string` (idema o nombre)  | Última observación convencional (temperatura, humedad, viento, precip.). |
| `avisos`               | `area: string` (CCAA)                 | Avisos meteorológicos vigentes por comunidad autónoma. |

Notas de diseño:

- `buscar_municipio` es clave: AEMET trabaja con **códigos INE de 5 dígitos**, no
  con nombres. Se bundlea un dataset estático de municipios (nombre + código INE)
  para resolver sin llamadas extra, con match **tolerante a acentos y mayúsculas**.
- Cada herramienta lleva descripción clara e `inputSchema` con **zod**.
- Se devuelve **texto estructurado y legible** (resumen + datos), no el JSON crudo.

## Tecnologías

- **TypeScript** (strict), Node ≥ 18.
- **`@modelcontextprotocol/sdk`** — se usa la API vigente de la versión instalada
  (`McpServer` + registro de tools con esquemas zod). Se sigue la firma actual del
  paquete instalado, no la memoria.
- **`zod`** para esquemas de entrada.
- **`fetch` nativo** de Node (sin axios).
- Caché **en memoria** con TTL (`Map` + timestamp): ~10 min predicción, ~5 min
  observación.
- Transport **stdio** (clientes locales tipo Claude Desktop).
- Build con **tsup**, tests con **vitest**.
- API key vía variable de entorno **`AEMET_API_KEY`**; nunca hardcodeada.
- `bin` en package.json para que funcione `npx aemet-mcp`.

## Peculiaridades de la API de AEMET (aquí falla lo ingenuo)

- **Base URL:** `https://opendata.aemet.es/opendata/api`
- **API key** gratuita (alta en OpenData, llega por email). Se envía en la cabecera
  `api_key: <KEY>` (o como query `?api_key=`).
- **Patrón de dos pasos:** la primera respuesta NO trae los datos. Trae un JSON
  `{ estado, descripcion, datos: "<url>", metadatos: "<url>" }`. Hay que hacer un
  **segundo GET** a la url de `datos`. Encapsulado en `fetchAemet()`.
- **Encoding:** los ficheros de `datos` vienen en **ISO-8859-1 (latin1)**, no
  UTF-8. Se decodifican con `new TextDecoder('latin1')`.
- **Códigos de estado** (`estado` del primer JSON): `200` ok, `401` key inválida,
  `404` sin datos, `429` too many requests. Cada uno mapea a un error MCP claro.
- **Endpoints:**
  - Predicción diaria: `/prediccion/especifica/municipio/diaria/{codigoINE}`
  - Predicción horaria: `/prediccion/especifica/municipio/horaria/{codigoINE}`
  - Observación de estación: `/observacion/convencional/datos/estacion/{idema}`
  - Inventario de estaciones: `/valores/climatologicos/inventarioestaciones/todasestaciones`
  - Avisos CAP por área: `/avisos_cap/ultimoelaborado/area/{codigoArea}`
    ⚠️ Devuelve un **tar.gz de XML (formato CAP)**, no JSON. Fase separada.

## Arquitectura

```
src/
  index.ts            # entrypoint: crea McpServer, registra tools, conecta stdio
  aemet/
    client.ts         # fetchAemet(): dos pasos + latin1 + manejo de estado
    cache.ts          # caché en memoria con TTL
    municipios.ts     # dataset estático INE + resolver nombre→código
    types.ts          # tipos de las respuestas de AEMET
  tools/
    prediccion.ts     # prediccion_diaria, prediccion_horaria
    observacion.ts    # observacion_estacion
    avisos.ts         # avisos
    municipio.ts      # buscar_municipio
  data/
    municipios.json   # dataset INE bundleado
test/
  *.test.ts
```

## Fases

**Fase 0 — Scaffold** ✅ criterio: `npx @modelcontextprotocol/inspector` conecta y
lista 0 tools sin errores.
- package.json (`bin`, `type: module`), tsconfig strict, tsup, vitest, README stub.
- `index.ts` que arranca un McpServer vacío por stdio.

**Fase 1 — Cliente AEMET** ✅ criterio: un script de prueba obtiene la predicción
diaria de Madrid (INE `28079`) con acentos correctos.
- `fetchAemet()` con dos pasos, latin1 y mapeo de estado a errores tipados.
- Caché con TTL. Resolver de municipios.

**Fase 2 — Herramientas MVP** ✅ criterio: desde el MCP Inspector se invocan las 4
y devuelven datos reales y bien formateados.
- `buscar_municipio`, `prediccion_diaria`, `prediccion_horaria`,
  `observacion_estacion`, cada una con zod y salida legible.

**Fase 3 — Avisos (stretch) + robustez** ✅ criterio: suite verde; `avisos`
devuelve avisos de una CCAA con avisos activos.
- `avisos`: descomprime tar.gz, parsea CAP XML, resume avisos vigentes.
- Reintentos con backoff ante 429; tests vitest (fetch mockeado) que cubran los
  dos pasos, latin1 y cada código de estado.

**Fase 4 — DX y publicación** ✅ criterio: `npx aemet-mcp` desde checkout limpio
arranca el servidor.
- README (qué es, cómo obtener la key, config Claude Desktop y Cursor, ejemplos).
- LICENSE (MIT), `files`/`bin` correctos, `npm publish --dry-run` limpio.

## Config de cliente (Claude Desktop)

```json
{
  "mcpServers": {
    "aemet": {
      "command": "npx",
      "args": ["-y", "aemet-mcp"],
      "env": { "AEMET_API_KEY": "TU_KEY" }
    }
  }
}
```

## Qué NO hacer

- No añadir servidor HTTP ni web: es un MCP por stdio, nada más.
- No mockear datos en producción ni ocultar errores de AEMET tras defaults.
- No meter dependencias pesadas (ni framework, ni ORM, ni axios).
- No hardcodear la API key ni subirla al repo.

## Decisión (cerrada)

`avisos` **entra en el producto**: implementado en la Fase 3 (tar.gz + CAP XML sin
dependencias). Las 5 herramientas están operativas y verificadas contra la API real.

Publicación: nombre npm **`@rldona/aemet-mcp`** (el nombre `aemet-mcp` sin scope ya
estaba ocupado por otro autor). `npx -y @rldona/aemet-mcp` arranca el servidor.
