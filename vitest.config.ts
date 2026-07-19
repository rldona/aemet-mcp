import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Solo los tests del proyecto, para no recoger ficheros *.test.ts ajenos
    // (p. ej. de herramientas externas en el árbol de trabajo).
    include: ["test/**/*.test.ts"],
  },
});
