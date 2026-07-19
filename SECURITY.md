# Política de seguridad

## Manejo de la API key

- La API key de AEMET se lee **exclusivamente** de la variable de entorno
  `AEMET_API_KEY`. **Nunca** se hardcodea ni se incluye en el repositorio o el
  paquete publicado.
- No la subas a git. El repo ignora `.env` y `.env.*` en `.gitignore`.
- En Claude Desktop / Cursor se pasa por el bloque `env` de la configuración del
  servidor MCP, que se guarda en tu máquina.
- El servidor no registra la key en logs. Los diagnósticos van a `stderr` y no
  incluyen credenciales.

## Alcance y superficie

- aemet-mcp es un proceso local que habla MCP por **stdio**; no abre puertos ni
  expone una API de red.
- Solo hace peticiones salientes **HTTPS** a `opendata.aemet.es` (y a las URLs de
  `datos` que devuelve AEMET, del mismo dominio).
- Dependencias de runtime mínimas (`@modelcontextprotocol/sdk`, `zod`) para reducir
  superficie de ataque (ver [ADR-0002](./docs/adr/0002-sin-dependencias-pesadas.md)).

## Reportar una vulnerabilidad

Si encuentras un problema de seguridad:

1. **No** abras un issue público con los detalles.
2. Usa el aviso privado de GitHub:
   *Security → Report a vulnerability* en <https://github.com/rldona/aemet-mcp>.
3. Incluye pasos para reproducir y el impacto potencial.

Se responderá lo antes posible. Gracias por la divulgación responsable.

## Versiones soportadas

Al estar en `0.x`, se da soporte a la última versión publicada. Actualiza a la más
reciente antes de reportar.
