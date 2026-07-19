import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// La versión se inyecta en build para que el servidor MCP no la lleve escrita a
// mano: una copia desincronizada anuncia por MCP una versión que no es la que
// se publicó en npm.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

const base = {
  format: ["esm"] as const,
  target: "node18" as const,
  platform: "node" as const,
  outDir: "dist",
  sourcemap: true,
  // El dataset de municipios se importa como JSON y se bundlea.
  loader: { ".json": "json" as const },
  define: { __PKG_VERSION__: JSON.stringify(version) },
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
