# aemet-mcp

Servidor **MCP** (Model Context Protocol) para el **tiempo oficial de España**.
Da a Claude Desktop, Cursor y cualquier cliente MCP acceso a la API pública
[OpenData de AEMET](https://opendata.aemet.es/): predicción por municipio y
observación de estaciones, con los datos ya resueltos y formateados.

> Estado: las 5 herramientas funcionando y verificadas contra la API real de
> AEMET (buscar_municipio, prediccion_diaria, prediccion_horaria,
> observacion_estacion, avisos).

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

## Herramientas

| Herramienta            | Entrada                               | Devuelve |
|------------------------|---------------------------------------|----------|
| `buscar_municipio`     | `nombre`                              | Municipios coincidentes + código INE. |
| `prediccion_diaria`    | `municipio` (nombre o código), `dias?`| Predicción diaria (1-7 días): máx/mín, cielo, prob. lluvia, viento. |
| `prediccion_horaria`   | `municipio`, `dias?`                  | Predicción hora a hora (hoy y mañana). |
| `observacion_estacion` | `estacion?` (idema o nombre)          | Última observación de una estación (por defecto Madrid-Retiro). |
| `avisos`               | `area` (CCAA)                         | Avisos meteorológicos vigentes (nivel, zona, periodo). |

Los nombres se resuelven a código INE con tolerancia a acentos/mayúsculas; si un
nombre es ambiguo (p. ej. "Villanueva"), la herramienta devuelve las opciones con
su código para desambiguar.

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
