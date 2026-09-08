# Guía de publicación

El paquete se publica en npm como **`@rldona/aemet-mcp`** mediante **Trusted
Publishing (OIDC)** desde GitHub Actions: sin token, con provenance y sin staging
manual (ver [ADR-0011](./adr/0011-trusted-publishing-oidc.md)).

## Configuración inicial (una sola vez)

En **npmjs.com** → página del paquete
[`@rldona/aemet-mcp`](https://www.npmjs.com/package/@rldona/aemet-mcp) →
**Settings** → sección **Trusted Publisher** → **GitHub Actions**:

| Campo | Valor |
|-------|-------|
| Organization or user | `rldona` |
| Repository | `aemet-mcp` |
| Workflow filename | `publish.yml` |
| Environment | _(vacío)_ |

Guardar. A partir de ahí, el workflow puede publicar sin `NPM_TOKEN`.

> Tras configurarlo, puedes **borrar el secret `NPM_TOKEN`** del repo
> (Settings → Secrets and variables → Actions); ya no se usa.

## Publicar una nueva versión

1. Actualiza la versión en `package.json` (semver) y el `CHANGELOG.md`.
   ```bash
   npm version patch   # o minor / major — crea el commit y el tag vX.Y.Z
   git push --follow-tags
   ```
2. Crea la Release en GitHub con ese tag (dispara el workflow):
   ```bash
   gh release create v0.1.1 --title "v0.1.1" --notes-file docs/release-notes/v0.1.1.md
   ```
3. El workflow `publish.yml`:
   - actualiza npm a una versión con soporte OIDC,
   - verifica que el tag coincide con `package.json`,
   - corre `typecheck` + `test` + `build`,
   - ejecuta `npm publish` autenticándose por **OIDC** (provenance automática).

También puede lanzarse a mano desde **Actions → Publish to npm → Run workflow**
(`workflow_dispatch`), útil para reintentos.

## Requisitos técnicos (ya cubiertos en el workflow)

- `permissions: id-token: write` en el job.
- `npm install -g npm@latest` (Node trae una versión anterior a la que soporta
  OIDC; se necesita npm ≥ 11.5.1).
- `publishConfig` en `package.json`: `access: public` y
  `registry: https://registry.npmjs.org/`.
- **Validación del tarball antes de publicar**: el workflow ejecuta
  `npm run test:pack`, que empaqueta, instala el resultado en un proyecto limpio y
  comprueba resolución ESM y CommonJS, tipos, permisos del binario y handshake
  MCP. Es lo último que corre antes de `npm publish`, y es la única red que atrapa
  los fallos que solo existen en el artefacto publicado (condiciones de `exports`
  mal puestas, ficheros que faltan en `files`, bit de ejecución perdido).
- El build se ejecuta **antes** que los tests: el smoke test del servidor MCP
  arranca `dist/index.js` como proceso hijo.

## Publicación manual de emergencia

Si hiciera falta publicar sin CI (no recomendado):

```bash
npm login          # requiere 2FA/OTP según la config de la cuenta
npm publish        # usa publishConfig (registro público + acceso público)
```

Ten en cuenta que publicar con token puede quedar **retenido en "Staged Packages"**
y requerir confirmación manual en la web de npm; el flujo OIDC evita esto.
