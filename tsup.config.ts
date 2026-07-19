import { defineConfig } from "tsup";

const base = {
  format: ["esm"] as const,
  target: "node18" as const,
  platform: "node" as const,
  outDir: "dist",
  sourcemap: true,
  // El dataset de municipios se importa como JSON y se bundlea.
  loader: { ".json": "json" as const },
};

export default defineConfig([
  // Servidor MCP (bin): con shebang para `npx aemet-mcp`.
  {
    ...base,
    entry: ["src/index.ts"],
    clean: true,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  // Librería: la misma fontanería de AEMET, importable desde cualquier backend.
  {
    ...base,
    entry: ["src/lib.ts"],
    clean: false, // no pisar el bin recién generado
    dts: true,
  },
]);
