import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  // El dataset de municipios se importa como JSON y se bundlea en el binario.
  loader: {
    ".json": "json",
  },
  // Shebang para que `npx aemet-mcp` sea ejecutable directamente.
  banner: {
    js: "#!/usr/bin/env node",
  },
});
