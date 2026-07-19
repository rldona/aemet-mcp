import { describe, it, expect } from "vitest";
import { AemetClient } from "../src/aemet/client.js";
import type { PrediccionMunicipio } from "../src/aemet/types.js";
import { obtenerAvisos } from "../src/aemet/avisos.js";

// Test de integración REAL contra la API de AEMET.
// Se ejecuta solo si AEMET_API_KEY está definida; si no, se salta.
//   AEMET_API_KEY=xxx npx vitest run test/integration.aemet.test.ts
const apiKey = process.env.AEMET_API_KEY;

describe.skipIf(!apiKey)("integración AEMET (requiere AEMET_API_KEY)", () => {
  it(
    "obtiene la predicción diaria de Madrid (28079) con acentos correctos",
    async () => {
      const client = new AemetClient({ apiKey: apiKey! });
      const data = await client.fetchJson<PrediccionMunicipio[]>(
        "/prediccion/especifica/municipio/diaria/28079",
      );

      expect(Array.isArray(data)).toBe(true);
      const pred = data[0];
      expect(pred?.nombre).toBe("Madrid");
      expect(pred?.prediccion?.dia?.length).toBeGreaterThan(0);

      // Prueba de fuego del latin1: la provincia es "Madrid", pero el bloque
      // trae acentos en otros campos; verificamos que no hay bytes rotos (ï¿½/Ã).
      const raw = JSON.stringify(data);
      expect(raw).not.toMatch(/�/); // carácter de reemplazo Unicode
    },
    20_000,
  );

  it(
    "descarga y parsea los avisos CAP (tar.gz) de Andalucía (61)",
    async () => {
      const client = new AemetClient({ apiKey: apiKey! });
      const { avisos } = await obtenerAvisos(client, "61");
      expect(Array.isArray(avisos)).toBe(true);
      // Estructura correcta si hay alguno (el contenido varía cada día).
      for (const a of avisos.slice(0, 5)) {
        expect(["amarillo", "naranja", "rojo"]).toContain(a.nivel);
        expect(typeof a.zona).toBe("string");
        expect(JSON.stringify(a)).not.toMatch(/�/);
      }
    },
    20_000,
  );
});
