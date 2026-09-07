import { describe, it, expect } from "vitest";
import { parsePoligono, puntoEnPoligono, type Punto } from "../src/aemet/geo.js";
import { distanciaKm, parseCoordenadaDMS } from "../src/aemet/estaciones.js";

describe("parseCoordenadaDMS", () => {
  it("convierte las coordenadas del inventario a grados decimales", () => {
    // Madrid-Retiro (idema 3195) según el inventario real de AEMET:
    // latitud "402441N", longitud "034040W" -> 40.4114, -3.6778.
    expect(parseCoordenadaDMS("402441N")).toBeCloseTo(40.4114, 4);
    expect(parseCoordenadaDMS("034040W")).toBeCloseTo(-3.6778, 4);
  });

  it("aplica el signo al hemisferio sur y oeste", () => {
    expect(parseCoordenadaDMS("280000N")).toBeCloseTo(28, 6);
    expect(parseCoordenadaDMS("280000S")).toBeCloseTo(-28, 6);
    expect(parseCoordenadaDMS("0150000E")).toBeCloseTo(15, 6);
    // Algunos registros usan "O" (oeste en español) en lugar de "W".
    expect(parseCoordenadaDMS("015000O")).toBeCloseTo(-1.8333, 4);
  });

  it("acepta los 60 segundos que publica AEMET, que son un acarreo", () => {
    // Valores reales del inventario: RONDA INSTITUTO (6032X), MARBELLA (6083X)
    // y MOLLERUSSA (9729X) traen 60 segundos, que es 0 segundos del minuto
    // siguiente. Rechazarlos perdía tres estaciones con coordenadas correctas.
    expect(parseCoordenadaDMS("364460N")).toBeCloseTo(36.75, 6); // 36º44'60" = 36º45'
    expect(parseCoordenadaDMS("362860N")).toBeCloseTo(36.4833, 4);
    expect(parseCoordenadaDMS("005160E")).toBeCloseTo(0.8667, 4);
  });

  it("rechaza lo que no sabe leer en vez de inventar un número", () => {
    expect(parseCoordenadaDMS(undefined)).toBeUndefined();
    expect(parseCoordenadaDMS("")).toBeUndefined();
    expect(parseCoordenadaDMS("basura")).toBeUndefined();
    expect(parseCoordenadaDMS("1234N")).toBeUndefined(); // muy corta
    expect(parseCoordenadaDMS("407841N")).toBeUndefined(); // 78 minutos
    expect(parseCoordenadaDMS("402499N")).toBeUndefined(); // 99 segundos
    expect(parseCoordenadaDMS("406199N")).toBeUndefined(); // 61 minutos: basura
  });
});

describe("distanciaKm", () => {
  const madrid = { latitud: 40.4168, longitud: -3.7038 };
  const barcelona = { latitud: 41.3874, longitud: 2.1686 };

  it("calcula la distancia entre dos ciudades", () => {
    // Madrid-Barcelona en línea recta son unos 505 km.
    expect(distanciaKm(madrid, barcelona)).toBeGreaterThan(495);
    expect(distanciaKm(madrid, barcelona)).toBeLessThan(515);
  });

  it("es cero consigo mismo y simétrica", () => {
    expect(distanciaKm(madrid, madrid)).toBeCloseTo(0, 6);
    expect(distanciaKm(madrid, barcelona)).toBeCloseTo(distanciaKm(barcelona, madrid), 6);
  });
});

describe("parsePoligono", () => {
  it("lee los pares lat,lon que publica AEMET en los CAP", () => {
    const p = parsePoligono("37.02,-4.27 37.12,-4.29 37.18,-4.33 37.02,-4.27");
    expect(p).toHaveLength(4);
    expect(p[0]).toEqual({ latitud: 37.02, longitud: -4.27 });
  });

  it("descarta un contorno que no puede cerrar un área", () => {
    expect(parsePoligono("37.02,-4.27 37.12,-4.29")).toEqual([]);
    expect(parsePoligono("")).toEqual([]);
    expect(parsePoligono("basura")).toEqual([]);
  });
});

describe("puntoEnPoligono", () => {
  // Cuadrado de 2x2 grados centrado en (1,1).
  const cuadrado: Punto[] = [
    { latitud: 0, longitud: 0 },
    { latitud: 0, longitud: 2 },
    { latitud: 2, longitud: 2 },
    { latitud: 2, longitud: 0 },
  ];

  it("detecta un punto interior", () => {
    expect(puntoEnPoligono({ latitud: 1, longitud: 1 }, cuadrado)).toBe(true);
  });

  it("detecta un punto exterior", () => {
    expect(puntoEnPoligono({ latitud: 3, longitud: 1 }, cuadrado)).toBe(false);
    expect(puntoEnPoligono({ latitud: 1, longitud: -1 }, cuadrado)).toBe(false);
  });

  it("funciona con un contorno cóncavo", () => {
    // Forma de "U": el hueco central queda fuera.
    const u: Punto[] = [
      { latitud: 0, longitud: 0 },
      { latitud: 0, longitud: 3 },
      { latitud: 1, longitud: 3 },
      { latitud: 1, longitud: 1 },
      { latitud: 2, longitud: 1 },
      { latitud: 2, longitud: 3 },
      { latitud: 3, longitud: 3 },
      { latitud: 3, longitud: 0 },
    ];
    expect(puntoEnPoligono({ latitud: 0.5, longitud: 0.5 }, u)).toBe(true);
    expect(puntoEnPoligono({ latitud: 1.5, longitud: 2 }, u)).toBe(false);
  });

  it("funciona con longitudes negativas, que es el caso español", () => {
    // Zona aproximada de la Cuenca del Genil (Granada).
    const zona: Punto[] = [
      { latitud: 37.0, longitud: -4.3 },
      { latitud: 37.6, longitud: -4.3 },
      { latitud: 37.6, longitud: -3.3 },
      { latitud: 37.0, longitud: -3.3 },
    ];
    expect(puntoEnPoligono({ latitud: 37.18, longitud: -3.6 }, zona)).toBe(true);
    expect(puntoEnPoligono({ latitud: 36.84, longitud: -2.46 }, zona)).toBe(false);
  });
});
