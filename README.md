# aemet-mcp

[![CI](https://github.com/rldona/aemet-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rldona/aemet-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@rldona/aemet-mcp)](https://www.npmjs.com/package/@rldona/aemet-mcp)

> npm: **`@rldona/aemet-mcp`** · `npx -y @rldona/aemet-mcp`

Servidor **MCP** (Model Context Protocol) para el **tiempo oficial de España**.
Da a Claude Desktop, Cursor y cualquier cliente MCP acceso a la API pública
[OpenData de AEMET](https://opendata.aemet.es/): predicción por municipio,
observación de estaciones y avisos meteorológicos, con los datos ya resueltos y
formateados en texto legible.

- 🧭 **5 herramientas** tipadas: buscar municipio, predicción diaria, predicción
  horaria, observación de estación y avisos por comunidad autónoma.
- 🇪🇸 **8132 municipios** del padrón del INE bundleados: resuelve nombres a código
  INE sin llamadas extra, tolerante a acentos y mayúsculas.
- ⚙️ Un solo `npx`, sin backend propio. Caché en memoria y reintentos ante fallos
  transitorios de AEMET.
- 🔒 Sin datos inventados: si un endpoint de AEMET falla, se propaga un error claro.

## Por qué

AEMET trabaja con **códigos INE de 5 dígitos**, sirve los datos en **dos pasos**,
en **ISO-8859-1** y los avisos como un **tar.gz de XML (CAP)**. Este servidor
esconde toda esa fontanería: le pides el tiempo de "Málaga" y te devuelve texto
legible, sin códigos ni JSON crudo.

## Requisitos

- Node.js ≥ 18
- Una **API key gratuita de AEMET OpenData**.

### Obtener la API key

1. Ve a <https://opendata.aemet.es/centrodedescargas/inicio> → "Solicitar API Key".
2. Introduce tu email; recibirás la key por correo (es un token largo tipo JWT).
3. Guárdala; se pasa al servidor por la variable de entorno `AEMET_API_KEY`.

## Uso con Claude Desktop

Edita `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aemet": {
      "command": "npx",
      "args": ["-y", "@rldona/aemet-mcp"],
      "env": { "AEMET_API_KEY": "TU_KEY" }
    }
  }
}
```

Reinicia Claude Desktop y pregúntale: *"¿Qué tiempo hará mañana en Cádiz?"* o
*"¿Hay avisos meteorológicos en Cataluña?"*.

## Uso con Cursor

En `~/.cursor/mcp.json` (o Settings → MCP → Add):

```json
{
  "mcpServers": {
    "aemet": {
      "command": "npx",
      "args": ["-y", "@rldona/aemet-mcp"],
      "env": { "AEMET_API_KEY": "TU_KEY" }
    }
  }
}
```

## Herramientas

| Herramienta            | Entrada                               | Devuelve |
|------------------------|---------------------------------------|----------|
| `buscar_municipio`     | `nombre`                              | Municipios coincidentes + código INE. |
| `prediccion_diaria`    | `municipio` (nombre o código), `dias?`| Predicción diaria (1-7 días): máx/mín, cielo, prob. lluvia, viento. |
| `prediccion_horaria`   | `municipio`, `dias?`                  | Predicción hora a hora (hoy y mañana). |
| `observacion_estacion` | `estacion?` (idema o nombre)          | Última observación (por defecto Madrid-Retiro). |
| `avisos`               | `area` (CCAA)                         | Avisos meteorológicos vigentes (nivel, zona, periodo). |

Los nombres se resuelven a código INE con tolerancia a acentos/mayúsculas; si un
nombre es ambiguo (p. ej. "Villanueva"), la herramienta devuelve las opciones con
su código para desambiguar.

### Ejemplos de salida

**`prediccion_diaria` — Madrid, 2 días**

```
Predicción diaria — Madrid (Madrid)
Elaborada: 2026-07-19 07:23:09

domingo 19/07
  Máx 36 °C / Mín 22 °C  |  Cielo: Poco nuboso  |  Prob. precip.: 0%  |  Viento: SO 15 km/h

lunes 20/07
  Máx 35 °C / Mín 21 °C  |  Cielo: Despejado  |  Prob. precip.: 0%  |  Viento: SO 20 km/h
```

**`observacion_estacion` — sin argumentos (Madrid-Retiro)**

```
Última observación — MADRID RETIRO (estación 3195)
Hora (UTC): 2026-07-19T07:00:00+0000

Temperatura:  21.7 °C
Humedad:      41 %
Precip. (última hora): 0 mm
Viento:       1.4 m/s del 143°
Presión:      939.2 hPa
```

**`avisos` — Andalucía**

```
Avisos meteorológicos vigentes — Andalucía
Elaborado: 2026-07-18 21:50:01
52 avisos (12 naranja, 40 amarillo). Nivel máximo: NARANJA.

🟠 NARANJA (12)
  • Cuenca del Genil: Temperaturas máximas  ·  19/07 13:00 → 19/07 20:59  ·  Temperatura máxima: 40 ºC.  ·  prob. 40%-70%
  ...
```

## Comunidades autónomas válidas para `avisos`

Andalucía, Aragón, Asturias, Islas Baleares, Canarias, Cantabria, Castilla y León,
Castilla-La Mancha, Cataluña, Extremadura, Galicia, Comunidad de Madrid, Región de
Murcia, Navarra, País Vasco, La Rioja, Comunidad Valenciana, Ceuta, Melilla.
Se aceptan alias comunes (p. ej. "euskadi", "madrid", "valencia").

## Cómo funciona (interno)

- **Patrón de dos pasos de AEMET:** la primera respuesta trae `{ estado, datos: url }`;
  el contenido real se descarga en un segundo GET. Encapsulado en `AemetClient`.
- **Encoding:** los ficheros de datos y los sobres vienen en **latin1**; se
  decodifican con `TextDecoder('latin1')` para no romper los acentos.
- **Estados** `200/401/404/429` mapeados a errores claros; reintentos con backoff
  ante `429` y fallos de red/5xx transitorios.
- **Avisos:** `tar.gz` de CAP XML descomprimido y parseado sin dependencias.
- **Caché** en memoria con TTL: ~10 min predicción/avisos, ~5 min observación,
  24 h inventario de estaciones.

## Documentación

- [Documentación funcional](./docs/functional-spec.md) — capacidades y casos de uso.
- [Arquitectura técnica](./docs/architecture.md) — módulos, flujos y diagramas.
- [Referencia de herramientas](./docs/tools-reference.md) — entradas, salidas, errores.
- [Notas de la API de AEMET](./docs/aemet-api-notes.md) — particularidades del upstream.
- [Decisiones de arquitectura (ADR)](./docs/adr/README.md).
- [CHANGELOG](./CHANGELOG.md) · [Contribuir](./CONTRIBUTING.md) · [Seguridad](./SECURITY.md)

## Desarrollo

```bash
npm install
npm test                 # unitarios (fetch mockeado; sin API key)
npm run typecheck
npm run build

# Test de integración real contra AEMET:
AEMET_API_KEY=xxx npx vitest run test/integration.aemet.test.ts

# Probar con el MCP Inspector:
AEMET_API_KEY=xxx npm run inspector
```

### Regenerar el dataset de municipios

`src/data/municipios.json` se genera del diccionario oficial del INE:

```bash
node scripts/generate-municipios.mjs   # descarga y parsea el padrón del INE
```

## Créditos y licencia

Datos meteorológicos: © [AEMET](https://www.aemet.es). Uso de la información
autorizado citando a AEMET como autora. Dataset de municipios: INE.

Licencia del software: [MIT](./LICENSE).
