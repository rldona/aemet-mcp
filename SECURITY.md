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

## Auditoría de dependencias

CI ejecuta `npm run audit:prod` (`npm audit --omit=dev --audit-level=high`) en cada
push y pull request, y **falla ante vulnerabilidades altas o críticas** en
dependencias de producción.

**Por qué solo producción.** Las dependencias de desarrollo (tsup, vitest,
typescript) no viajan en el paquete publicado: un aviso en ellas no afecta a quien
instala `@rldona/aemet-mcp`. Bloquear el merge por eso sería ruido.

**Por qué el umbral está en `high`.** Los avisos moderados en este árbol suelen ser
DoS en rutas HTTP que este servidor no ejecuta (habla stdio). Se revisan, pero no
paran el trabajo.

**Transitivas que no podemos actualizar directamente.** El SDK de MCP arrastra un
servidor HTTP completo (`express`, `hono`, `express-rate-limit`) para transportes
que este proyecto no usa. Cuando ahí aparece un aviso y el SDK aún no ha publicado
la actualización, se fija la versión parcheada con `overrides` en `package.json`,
comentando por qué. Es lo que hay hoy para `ip-address`, `hono`,
`@hono/node-server`, `qs` y `fast-uri`.

**Excepciones.** `npm audit` no permite silenciar un aviso concreto, así que la vía
no es relajar el umbral global para esquivar uno. Si un aviso no es explotable aquí
y aún no hay versión parcheada, se documenta en el PR —enlace al advisory, por qué
no aplica y fecha de revisión— y, si hace falta desbloquear el merge, se usa un
`overrides` temporal apuntando a la última versión disponible.

## Cadena de publicación

El paquete se publica con **Trusted Publishing (OIDC)** desde GitHub Actions: sin
`NPM_TOKEN`, con provenance. Alrededor de eso:

- **Las GitHub Actions van fijadas por SHA de commit**, no por tag. Un tag como
  `v4` es móvil: quien controle el repositorio de la acción puede reapuntarlo a
  otro commit, y ese código correría en un job que tiene permiso de publicación.
  El comentario `# v4` que acompaña a cada SHA es informativo; el SHA manda.
- **La versión de npm del workflow de publicación está fijada** en lugar de usar
  `@latest`, por el mismo motivo: ese job publica, y `@latest` arrastraría
  cualquier versión recién salida sin revisión.
- **CI declara `permissions: contents: read`**, para no heredar los permisos por
  defecto del repositorio.
- Dependabot revisa las Actions una vez al mes y actualiza SHA y comentario a la
  vez. La versión de npm no la cubre: se sube a mano al preparar cada release.

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
