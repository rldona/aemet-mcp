# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

_Nada por ahora._

## [0.2.1] - 2026-07-19

### Corregido

- **Packaging**: se añade la condición `default` a `exports` (además de `import`),
  para que los consumidores que resuelven en CommonJS (ts-node, jest en CJS, `tsx`
  en proyectos sin `"type": "module"`) no fallen con `ERR_PACKAGE_PATH_NOT_EXPORTED`
  al hacer `require()` del paquete. La resolución ESM ya funcionaba.

## [0.2.0] - 2026-07-19

### Añadido

- **API de librería**: el paquete ahora es importable (`import { AemetClient, … }
  from "@rldona/aemet-mcp"`) además de ejecutable como servidor MCP. Expone el
  cliente de dos pasos, municipios (búsqueda/resolución), áreas CAP, avisos
  (tar + CAP XML), estaciones, formateadores y tipos. Entrada `src/lib.ts`,
  con declaraciones de tipos (`dist/lib.d.ts`).
- `areaParaMunicipio(codigoINE)`: resuelve el área de avisos CAP (CCAA) a partir
  del código INE de un municipio (mapa provincia → área).
- `claveAviso(aviso)`: clave estable de un aviso para deduplicación.

### Corregido

- **Acentos rotos (mojibake) en respuestas de AEMET**: el servidor de datos
  devuelve codificaciones distintas según el nodo que responda (a veces UTF-8,
  a veces doblemente codificado, siempre declarando `charset=ISO-8859-15`).
  Ahora se decodifica con auto-detección (UTF-8 estricto con fallback latin1)
  y se repara el mojibake cadena a cadena tras el `JSON.parse`
  (`reparaMojibake`/`reparaProfundo`). Descubierto en producción en notemojes.com
  ("AndÃºjar" → "Andújar").
- El `fetch` global se resuelve en cada llamada en lugar de capturarse en el
  constructor (evita quedarse con un `fetch` parcheado obsoleto en runtimes
  que lo instrumentan, como Next.js).

## [0.1.2] - 2026-07-19

### Añadido

- `prediccion_diaria` muestra la **racha máxima de viento** (km/h) junto al viento,
  cuando AEMET la proporciona.

### Cambiado

- Las publicaciones incluyen **provenance** (`npm publish --provenance`); la 0.1.1
  se publicó sin atestación por un flag omitido.

## [0.1.1] - 2026-07-19

### Añadido

- `prediccion_diaria` ahora incluye la **humedad relativa** (máxima/mínima) de cada
  día, que AEMET ya proporcionaba y no se mostraba.

### Cambiado

- Publicación mediante **Trusted Publishing (OIDC)** desde GitHub Actions, sin
  `NPM_TOKEN` y con provenance automática (ver
  [ADR-0011](./docs/adr/0011-trusted-publishing-oidc.md)).

## [0.1.0] - 2026-07-19

Primera versión pública. Servidor MCP completo para el tiempo oficial de España
vía la API OpenData de AEMET, con 5 herramientas verificadas contra la API real.

### Añadido

- **Servidor MCP por stdio** (`@modelcontextprotocol/sdk`), enchufable a Claude
  Desktop, Cursor y cualquier cliente MCP sin adaptadores.
- **`buscar_municipio`** — resuelve nombre → código INE de 5 dígitos con match
  tolerante a acentos y mayúsculas; desambigua nombres repetidos.
- **`prediccion_diaria`** — predicción diaria (1-7 días): máx/mín, estado del
  cielo, probabilidad de precipitación y viento.
- **`prediccion_horaria`** — predicción hora a hora del día en curso y siguiente.
- **`observacion_estacion`** — última observación convencional de una estación
  (temperatura, humedad, viento, precipitación, presión); resuelve idema o nombre
  vía el inventario de estaciones.
- **`avisos`** — avisos meteorológicos vigentes por comunidad autónoma, parseados
  del formato CAP (tar.gz de XML) sin dependencias externas.
- **Cliente AEMET** (`AemetClient`) que encapsula el patrón de dos pasos de la API,
  decodifica latin1 (datos y sobres de error), mapea los estados `200/401/404/429`
  a errores tipados y reintenta con backoff ante `429`, fallos de red y `5xx`
  transitorios.
- **Dataset de 8132 municipios** del padrón oficial del INE, bundleado en el
  paquete (sin llamadas extra para resolver nombres).
- **Caché en memoria con TTL**: ~10 min predicción/avisos, ~5 min observación,
  24 h inventario de estaciones.
- **Suite de tests** con Vitest (38 tests: unitarios con `fetch` mockeado +
  integración real contra AEMET, esta última guardada por `AEMET_API_KEY`).
- **CI en GitHub Actions** (Node 18/20/22) y workflow de publicación con provenance.
- Documentación: README, especificación, documentación funcional y técnica, y
  registros de decisiones de arquitectura (ADR).

### Notas

- Publicado como paquete con scope **`@rldona/aemet-mcp`** (el nombre `aemet-mcp`
  sin scope ya estaba ocupado en npm por otro autor).
- No se inventan ni mockean datos en producción: si un endpoint de AEMET falla, el
  error se propaga de forma clara.

[No publicado]: https://github.com/rldona/aemet-mcp/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/rldona/aemet-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rldona/aemet-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/rldona/aemet-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rldona/aemet-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rldona/aemet-mcp/releases/tag/v0.1.0
