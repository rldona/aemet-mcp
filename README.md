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
- 📚 **También librería**: importa el núcleo de AEMET (`AemetClient`, resolvers,
  avisos, formateadores) en cualquier backend Node/TS — ver
  [Uso como librería](#uso-como-librería).

## Por qué

AEMET trabaja con **códigos INE de 5 dígitos**, sirve los datos en **dos pasos**,
con **codificaciones inconsistentes** (UTF-8/latin1 según el recurso, a veces con
mojibake) y los avisos como un **tar.gz de XML (CAP)**. Este servidor esconde toda
esa fontanería: le pides el tiempo de "Málaga" y te devuelve texto legible, sin
códigos ni JSON crudo.

## Requisitos

- Node.js ≥ 20.19
- Una **API key gratuita de AEMET OpenData**.

El paquete es **ESM-only**: se publica un único build ES module, sin build
CommonJS. Aun así se puede consumir desde CommonJS con `require()`, porque Node
≥ 20.19 soporta `require(esm)` — de ahí ese suelo exacto. En Node 18 el
`import()` dinámico funciona, pero `require()` falla con `ERR_REQUIRE_ESM`.

### Obtener la API key

1. Ve a <https://opendata.aemet.es/centrodedescargas/inicio> → "Solicitar API Key".
2. Introduce tu email; recibirás la key por correo (es un token largo tipo JWT).
3. Guárdala; se pasa al servidor por la variable de entorno `AEMET_API_KEY`.

### Diagnóstico

`AEMET_MCP_LOG` controla el detalle de los mensajes, que van **siempre a
`stderr`** (`stdout` es el canal del protocolo MCP): `silent`, `error`, `warn`
(por defecto), `info` o `debug`. En `debug` se registran duración de cada
petición, reintentos y aciertos de caché. Nunca se registran credenciales: las
cabeceras no se tocan y a las URL se les borra la query.

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

| Herramienta             | Entrada                                | Devuelve |
|-------------------------|----------------------------------------|----------|
| `buscar_municipio`      | `nombre`                                          | Municipios coincidentes + código INE, provincia e isla. |
| `buscar_estacion`       | `consulta`, `limite?`                             | Estaciones de AEMET con idema, provincia, coordenadas y altitud. |
| `prediccion_diaria`     | `municipio` (nombre o código), `dias?`, `desde?`, `hasta?` | Predicción diaria (1-7 días): máx/mín, cielo, prob. lluvia, viento. |
| `prediccion_horaria`    | `municipio`, `dias?`, `desde?`, `hasta?`          | Predicción hora a hora (hoy y mañana). |
| `observacion_estacion`  | `estacion?` (idema o nombre)                      | Última observación (por defecto Madrid-Retiro). |
| `observacion_municipio` | `municipio`, `estacion?`                          | Tiempo actual en la estación con datos más cercana, con distancia y aviso si no representa al municipio. |
| `avisos`                | `area` (CCAA)                                     | Avisos meteorológicos vigentes (nivel, zona, periodo). |
| `avisos_municipio`      | `municipio`, `incluirComunidad?`                  | Avisos que afectan a ese municipio, acotados por geometría. |

Los nombres se resuelven a código INE con tolerancia a acentos, mayúsculas y
artículos: `El Campello`, `Campello` y `Campello, el` (la forma del INE) llevan al
mismo sitio. Si un nombre es ambiguo (p. ej. "Villanueva" o "La Zarza", que existe
en Badajoz y en Valladolid), la herramienta devuelve las opciones con su provincia
y su código para desambiguar.

**Islas.** AEMET solo entiende municipios, pero la gente pregunta por islas. Los
nombres de las 11 islas de Canarias y Baleares se reconocen y devuelven sus
municipios: "El Hierro" da Frontera, Valverde y El Pinar, y no "Cueva del Hierro"
(Cuenca). Cada municipio insular lleva su `isla`, que es lo que permite saber cuál
de los quince "Valverde" es el de El Hierro.

**Unidades y fechas.** Todo el viento va en **km/h** y la dirección viene en las
dos formas (rumbo y grados), venga como venga de AEMET. Los instantes salen en ISO
8601 con offset explícito. Cada respuesta con magnitudes trae un campo `unidades`
en el propio payload, para no tener que deducirlas del orden de magnitud.

Todas las herramientas declaran `outputSchema` y devuelven `structuredContent`
además del texto, así que un agente puede consumir los valores tipados —fechas,
códigos, grados, porcentajes— sin parsear prosa.

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
Hora del dato: 2026-07-19T07:00:00+00:00

Temperatura:  21.7 °C
Humedad:      41 %
Precip. (última hora): 0 mm
Viento:       SE a 5 km/h (143°)
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

## Uso como librería

Además del servidor MCP, el paquete exporta su **núcleo de AEMET** como librería,
para consumirlo desde cualquier backend Node/TS (una web del tiempo, un cron de
avisos, etc.) **sin pasar por MCP**. Toda la fontanería difícil ya está resuelta:
patrón de dos pasos, codificación inconsistente + reparación de mojibake, caché con
TTL, reintentos con backoff, dataset de municipios del INE, áreas CAP y parseo de
avisos (tar + CAP XML).

> ⚠️ La API key va **siempre en el servidor** (variable de entorno), nunca en el
> navegador.

El paquete es ESM-only (ver [Requisitos](#requisitos)): `import` desde ESM, o
`require()` desde CommonJS en Node ≥ 20.19.

```ts
import {
  AemetClient,
  resolverMunicipio,
  resolverArea,
  obtenerAvisos,
  formatDiaria,
  seleccionarDias,
  type PrediccionDiariaMunicipio,
} from "@rldona/aemet-mcp";

const client = new AemetClient({ apiKey: process.env.AEMET_API_KEY! });

// 1) Nombre -> código INE (offline; dataset del INE bundleado, sin gastar cuota)
const madrid = resolverMunicipio("Madrid"); // { codigo: "28079", nombre: "Madrid" }

// 2) Predicción diaria TIPADA (dos pasos + encoding + caché ya resueltos)
const [pred] = await client.fetchJson<PrediccionDiariaMunicipio[]>(
  `/prediccion/especifica/municipio/diaria/${madrid.codigo}`,
);
console.log(pred.prediccion.dia[0]?.temperatura); // { maxima, minima, dato, ... }

// (opcional) texto legible ya formateado
console.log(formatDiaria(pred, seleccionarDias(pred.prediccion.dia, { max: 3 })));

// 3) Avisos vigentes de una CCAA (descomprime el tar.gz y parsea el CAP por ti)
const andalucia = resolverArea("Andalucía"); // { codigo: "61", nombre: "Andalucía" }
const { avisos } = await obtenerAvisos(client, andalucia.codigo);
```

### Qué se exporta

| Categoría | Exports |
|-----------|---------|
| Cliente | `AemetClient`, `TTL`, `AemetError`, `describeEstado`, `TtlCache` |
| Encoding | `reparaMojibake`, `reparaProfundo` |
| Municipios | `resolverMunicipio`, `buscarMunicipios`, `municipioPorCodigo`, `esCodigoINE`, `normalize`, `totalMunicipios` |
| Islas | `resolverIsla`, `islaDeMunicipio`, `islas`, `municipiosDeIsla`, `municipiosDeProvincia` |
| Unidades | `msAKmh`, `rumboDesdeGrados`, `gradosDesdeRumbo`, `vientoDeObservacion`, `vientoDePrediccion`, `isoConOffset` |
| Áreas / avisos | `AREAS`, `resolverArea`, `areaParaMunicipio`, `obtenerAvisos`, `extraerAvisos`, `parseCapAlert`, `claveAviso` |
| Estaciones | `resolverEstacion`, `pareceIdema` |
| Formateadores | `formatDiaria`, `formatHoraria`, `formatObservacion`, `formatAvisos`, `formatMunicipios`, `seleccionarDias` |
| Bajo nivel | `untar`, `readOctal`, `validarUrlDatos`, `AEMET_HOSTS` |
| Tipos | `PrediccionDiariaMunicipio`, `PrediccionHorariaMunicipio`, `Observacion`, `Municipio`, `Aviso`, `NivelAviso`, `ResultadoAvisos`, … |

El `AemetClient` acepta opciones (`timeoutMs`, `maxBytes`, `maxRetries`,
`backoffBaseMs`, `allowedHosts`, `fetchImpl`, `sleep`) además de `apiKey`. Los
tipos van incluidos (`dist/lib.d.ts`).

📖 **Referencia completa** (todas las funciones, tipos, rutas de endpoint y recetas
para una web del tiempo): [docs/library.md](./docs/library.md).

## Cómo funciona (interno)

- **Patrón de dos pasos de AEMET:** la primera respuesta trae `{ estado, datos: url }`;
  el contenido real se descarga en un segundo GET. Encapsulado en `AemetClient`.
- **Encoding:** AEMET mezcla **UTF-8 y latin1** según el recurso/nodo CDN (y a veces
  declara mal el `charset`, produciendo mojibake). Se **auto-detecta** la
  codificación y se **repara el mojibake**; los sobres de error van en latin1.
  Ver [ADR-0012](./docs/adr/0012-codificacion-autodetectada-mojibake.md).
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
npm run test:pack        # valida el tarball instalado en un proyecto limpio

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
