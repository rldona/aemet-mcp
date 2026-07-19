# aemet-mcp

Servidor **MCP** (Model Context Protocol) para el **tiempo oficial de España**.
Da a Claude Desktop, Cursor y cualquier cliente MCP acceso a la API pública
[OpenData de AEMET](https://opendata.aemet.es/): predicción por municipio y
observación de estaciones, con los datos ya resueltos y formateados.

> Estado: en construcción. Fase 1 (cliente AEMET) completa. Herramientas MCP en
> Fase 2. Los avisos meteorológicos llegan en la Fase 3.

## Por qué

AEMET trabaja con **códigos INE de 5 dígitos**, sirve los datos en **dos pasos**
y en **ISO-8859-1**. Este servidor esconde toda esa fontanería: le pides el tiempo
de "Málaga" y te devuelve texto legible, sin códigos ni JSON crudo.

## Requisitos

- Node.js ≥ 18
- Una **API key gratuita de AEMET OpenData**.

### Obtener la API key

1. Ve a <https://opendata.aemet.es/centrodedescargas/inicio> → "Solicitar API Key".
2. Introduce tu email; recibirás la key por correo.
3. Guárdala; se pasa al servidor por la variable de entorno `AEMET_API_KEY`.

## Uso con Claude Desktop

Edita `claude_desktop_config.json`:

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

## Uso con Cursor

En `~/.cursor/mcp.json` (o Settings → MCP):

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

## Herramientas (previstas)

| Herramienta            | Entrada                               | Devuelve |
|------------------------|---------------------------------------|----------|
| `buscar_municipio`     | `nombre`                              | Municipios coincidentes + código INE. |
| `prediccion_diaria`    | `municipio` (nombre o código)         | Predicción diaria: máx/mín, cielo, prob. lluvia, viento. |
| `prediccion_horaria`   | `municipio`                           | Predicción hora a hora (hoy y mañana). |
| `observacion_estacion` | `estacion` (idema o nombre)           | Última observación de una estación. |
| `avisos` *(Fase 3)*    | `area` (CCAA)                         | Avisos meteorológicos vigentes. |

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

## Licencia

MIT
