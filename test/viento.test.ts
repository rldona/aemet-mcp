import { describe, it, expect } from "vitest";
import {
  gradosDesdeRumbo,
  msAKmh,
  rumboDesdeGrados,
  textoViento,
  vientoDeObservacion,
  vientoDePrediccion,
} from "../src/aemet/viento.js";

describe("unidades de viento", () => {
  it("convierte m/s a km/h", () => {
    // El caso del informe: la observación daba 2.5 (m/s) y la predicción 20
    // (km/h) sin decir cuál era cuál.
    expect(msAKmh(2.5)).toBe(9);
    expect(msAKmh(0)).toBe(0);
    expect(msAKmh(10)).toBe(36);
  });
});

describe("rumboDesdeGrados", () => {
  it("asigna cada sector de 45° a su rumbo", () => {
    expect(rumboDesdeGrados(0)).toBe("N");
    expect(rumboDesdeGrados(45)).toBe("NE");
    expect(rumboDesdeGrados(92)).toBe("E");
    expect(rumboDesdeGrados(180)).toBe("S");
    expect(rumboDesdeGrados(270)).toBe("O");
    expect(rumboDesdeGrados(315)).toBe("NO");
  });

  it("cierra el círculo por el norte", () => {
    expect(rumboDesdeGrados(359)).toBe("N");
    expect(rumboDesdeGrados(360)).toBe("N");
    expect(rumboDesdeGrados(-45)).toBe("NO");
  });

  it("sin dato no inventa rumbo", () => {
    expect(rumboDesdeGrados(null)).toBeNull();
    expect(rumboDesdeGrados(undefined)).toBeNull();
    expect(rumboDesdeGrados(Number.NaN)).toBeNull();
  });
});

describe("gradosDesdeRumbo", () => {
  it("traduce los rumbos españoles e ingleses", () => {
    expect(gradosDesdeRumbo("NE")).toBe(45);
    expect(gradosDesdeRumbo("SO")).toBe(225);
    expect(gradosDesdeRumbo("O")).toBe(270);
    expect(gradosDesdeRumbo("W")).toBe(270); // forma inglesa del oeste
    expect(gradosDesdeRumbo("nno")).toBe(337.5);
  });

  it("'C' es calma, no un rumbo", () => {
    // Aparecía en la predicción sin estar documentado en ningún sitio.
    expect(gradosDesdeRumbo("C")).toBeNull();
  });

  it("un rumbo desconocido no se convierte en 0", () => {
    // Devolver 0 sería decir "norte", que es un dato inventado.
    expect(gradosDesdeRumbo("XYZ")).toBeNull();
    expect(gradosDesdeRumbo("")).toBeNull();
  });
});

describe("normalización por origen", () => {
  it("la predicción conserva su rumbo y gana los grados", () => {
    expect(vientoDePrediccion("NE", 20)).toEqual({
      velocidad: 20,
      direccion: "NE",
      direccionGrados: 45,
    });
  });

  it("la calma de la predicción no recibe grados", () => {
    expect(vientoDePrediccion("C", 0)).toEqual({
      velocidad: 0,
      direccion: "C",
      direccionGrados: null,
    });
  });

  it("la observación pasa a km/h y gana el rumbo", () => {
    // Tarifa en el informe: 2.5 m/s del este.
    expect(vientoDeObservacion(92, 2.5)).toEqual({
      velocidad: 9,
      direccion: "E",
      direccionGrados: 92,
    });
  });

  it("una observación con velocidad 0 es calma, y su dirección no significa nada", () => {
    expect(vientoDeObservacion(180, 0)).toEqual({
      velocidad: 0,
      direccion: "C",
      direccionGrados: null,
    });
  });

  it("sin velocidad no se inventa nada", () => {
    expect(vientoDeObservacion(180, undefined)).toEqual({
      velocidad: null,
      direccion: "S",
      direccionGrados: 180,
    });
  });
});

describe("textoViento", () => {
  it("dice la calma con palabras", () => {
    expect(textoViento(vientoDePrediccion("C", 0))).toBe("en calma");
  });

  it("da rumbo, velocidad y grados cuando los hay", () => {
    expect(textoViento(vientoDeObservacion(92, 2.5), true)).toBe("E a 9 km/h (92°)");
    // Sin pedir grados, la predicción no finge precisión que no tiene.
    expect(textoViento(vientoDePrediccion("SO", 15))).toBe("SO a 15 km/h");
  });

  it("sin velocidad no finge un dato", () => {
    expect(textoViento({ velocidad: null, direccion: "N", direccionGrados: 0 })).toBe("—");
  });
});
