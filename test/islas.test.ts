import { describe, it, expect } from "vitest";
import { islaDeMunicipio, islas, resolverIsla } from "../src/aemet/islas.js";
import {
  buscarMunicipios,
  municipiosDeIsla,
  municipioPorCodigo,
  resolverMunicipio,
} from "../src/aemet/municipios.js";

/**
 * Totales conocidos de municipios por isla. Son la comprobación de que la tabla
 * de `islas.ts` está bien: las islas grandes se calculan como "el resto de la
 * provincia", así que un código mal puesto en una isla pequeña se manifiesta
 * aquí como un descuadre en la grande.
 */
const ESPERADOS: Record<string, number> = {
  "El Hierro": 3,
  "La Gomera": 6,
  "La Palma": 14,
  Tenerife: 31,
  Lanzarote: 7,
  Fuerteventura: 6,
  "Gran Canaria": 21,
  Menorca: 8,
  Eivissa: 5,
  Formentera: 1,
  Mallorca: 53,
};

describe("tabla de islas", () => {
  it("cada isla tiene exactamente los municipios que le corresponden", () => {
    const reales = Object.fromEntries(
      islas().map((i) => [i.nombre, municipiosDeIsla(i).length]),
    );
    expect(reales).toEqual(ESPERADOS);
  });

  it("cubre las tres provincias insulares por completo", () => {
    // 07 + 35 + 38 = 67 + 34 + 54 = 155 municipios, todos con isla asignada.
    const total = Object.values(ESPERADOS).reduce((a, b) => a + b, 0);
    expect(total).toBe(155);
  });

  it("no asigna isla a la península, Ceuta ni Melilla", () => {
    expect(islaDeMunicipio("28079")).toBeUndefined(); // Madrid
    expect(islaDeMunicipio("51001")).toBeUndefined(); // Ceuta
    expect(islaDeMunicipio("52001")).toBeUndefined(); // Melilla
  });

  it("asigna la isla correcta a casos que se confunden entre sí", () => {
    // Dos "Sant Joan" en Baleares, uno en cada isla.
    expect(islaDeMunicipio("07049")?.nombre).toBe("Mallorca"); // Sant Joan
    expect(islaDeMunicipio("07050")?.nombre).toBe("Eivissa"); // Sant Joan de Labritja
    // Valverde es la capital de El Hierro y su nombre no lo dice.
    expect(islaDeMunicipio("38048")?.nombre).toBe("El Hierro");
    // Santa Cruz de la Palma es de La Palma; Santa Cruz de Tenerife, de Tenerife.
    expect(islaDeMunicipio("38037")?.nombre).toBe("La Palma");
    expect(islaDeMunicipio("38038")?.nombre).toBe("Tenerife");
  });

  it("resuelve nombres de isla y sus alias", () => {
    expect(resolverIsla("El Hierro")?.nombre).toBe("El Hierro");
    expect(resolverIsla("hierro")?.nombre).toBe("El Hierro");
    expect(resolverIsla("Ibiza")?.nombre).toBe("Eivissa");
    expect(resolverIsla("la gomera")?.nombre).toBe("La Gomera");
    expect(resolverIsla("Madrid")).toBeUndefined();
  });

  it("'Palma' a secas NO es la isla de La Palma", () => {
    // Es la ciudad de Mallorca. Confundirlas mandaría al usuario a 1.500 km.
    expect(resolverIsla("Palma")).toBeUndefined();
    expect(resolverMunicipio("Palma").codigo).toBe("07040");
    expect(municipioPorCodigo("07040")?.isla).toBe("Mallorca");
  });
});

describe("islas en la resolución de municipios", () => {
  it("un nombre de isla explica que lo es y enumera sus municipios", () => {
    expect(() => resolverMunicipio("El Hierro")).toThrow(/ISLA/);
    try {
      resolverMunicipio("El Hierro");
    } catch (e) {
      const msg = (e as Error).message;
      // Los tres municipios, incluidos los dos que no contienen "Hierro".
      expect(msg).toContain("Valverde");
      expect(msg).toContain("Frontera");
      expect(msg).toContain("38901");
      // Y NO el ruido por subcadena de antes.
      expect(msg).not.toContain("Cueva del Hierro");
    }
  });

  it("una isla de un solo municipio se resuelve sin preguntar", () => {
    expect(resolverMunicipio("Formentera").codigo).toBe("07024");
  });

  it("buscar por isla devuelve sus municipios, no coincidencias por subcadena", () => {
    const r = buscarMunicipios("El Hierro");
    const codigos = r.map((m) => m.codigo);
    expect(codigos.slice(0, 3).sort()).toEqual(["38013", "38048", "38901"]);
  });

  it("un municipio insular lleva su isla en la etiqueta", () => {
    const valverde = municipioPorCodigo("38048")!;
    expect(valverde.isla).toBe("El Hierro");
    // El caso del informe: 15 "Valverde" y ninguna pista de cuál es el de la isla.
    const r = buscarMunicipios("Valverde");
    expect(r[0]!.codigo).toBe("38048");
    expect(r[0]!.isla).toBe("El Hierro");
  });
});
