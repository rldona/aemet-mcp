# 0009 — Nombre de paquete con scope `@rldona`

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

El nombre natural del paquete, `aemet-mcp`, **ya estaba ocupado** en el registro
público de npm por otro autor (publicado como `aemet-mcp@0.1.x`). No es posible
publicar bajo ese nombre.

## Decisión

Publicar como paquete **con scope**: `@rldona/aemet-mcp`, bajo la cuenta npm del
autor. Se instala con `npx -y @rldona/aemet-mcp`.

Configuración asociada:

- `publishConfig.access = "public"` (los paquetes con scope son privados por
  defecto).
- `publishConfig.registry = "https://registry.npmjs.org/"` para que `npm publish`
  vaya siempre al registro público, independientemente del registro por defecto de
  la máquina.

## Consecuencias

- ➕ Nombre disponible y garantizado bajo el scope del autor.
- ➕ Mantiene el nombre legible "aemet-mcp" (con prefijo de scope).
- ➖ El comando incluye el scope (`@rldona/aemet-mcp`), ligeramente más largo.
- ➖ Requiere `--access public` / `publishConfig` para no publicarlo privado.

## Alternativas consideradas

- `aemet-mcp-server`, `mcp-aemet`: nombres sin scope libres, pero el scope mantiene
  la marca "aemet-mcp" y agrupa el paquete bajo el autor.
