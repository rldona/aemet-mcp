import { describe, it, expect } from "vitest";
import {
  DISTANCIA_FIABLE_KM,
  aSalidaObservacionMunicipio,
  evaluarEstacion,
  type Candidata,
  type EstadoCandidata,
} from "../src/tools/schemas.js";
import { notaNombreCompartido } from "../src/aemet/homonimos.js";
import { seleccionarDias } from "../src/aemet/format.js";
import { municipioPorCodigo } from "../src/aemet/municipios.js";
import type { Observacion } from "../src/aemet/types.js";

const ceuta = municipioPorCodigo("51001")!;
const madrid = municipioPorCodigo("28079")!;

const estacion = (over: Partial<Candidata>): Candidata => ({
  idema: "5000C",
  nombre: "TARIFA",
  provincia: "CADIZ",
  latitud: 36.01,
  longitud: -5.6,
  altitud: 32,
  distanciaKm: 29.7,
  ...over,
});

describe("evaluarEstacion", () => {
  it("marca el caso de Ceuta: lejos y en otra provincia", () => {
    // El fallo del informe: se respondía "en Ceuta hace 23,7 °C" con el dato de
    // Tarifa, al otro lado del Estrecho, y nada en el JSON lo delataba.
    const { representa, advertencia } = evaluarEstacion(ceuta, estacion({}));
    expect(representa).toBe(false);
    expect(advertencia).toContain("29.7 km");
    expect(advertencia).toContain("otra provincia");
    expect(advertencia).toContain("CADIZ");
  });

  it("una estación cercana de la misma provincia no genera ruido", () => {
    const cerca = estacion({
      nombre: "MADRID, RETIRO",
      provincia: "MADRID",
      distanciaKm: 3.2,
    });
    expect(evaluarEstacion(madrid, cerca)).toEqual({
      representa: true,
      advertencia: null,
    });
  });

  it("la distancia sola basta para advertir, aunque la provincia coincida", () => {
    const lejos = estacion({
      provincia: "MADRID",
      distanciaKm: DISTANCIA_FIABLE_KM + 0.1,
    });
    const { representa, advertencia } = evaluarEstacion(madrid, lejos);
    expect(representa).toBe(false);
    expect(advertencia).toContain("km");
    expect(advertencia).not.toContain("otra provincia");
  });

  it("el cruce de provincia solo basta, aunque esté al lado", () => {
    const alLado = estacion({ provincia: "CADIZ", distanciaKm: 2 });
    const { representa, advertencia } = evaluarEstacion(ceuta, alLado);
    expect(representa).toBe(false);
    expect(advertencia).toContain("otra provincia");
  });
});

describe("salida de observacion_municipio", () => {
  const obs: Observacion = {
    idema: "5000C",
    fint: "2026-09-08T07:00:00",
    ta: 23.7,
    hr: 91,
    vv: 2.5,
    dv: 92,
    pres: 1014,
  };

  it("lleva la advertencia y las unidades dentro del payload", () => {
    const elegida = estacion({});
    const estados = new Map<string, EstadoCandidata>([["5000C", "con datos"]]);
    const salida = aSalidaObservacionMunicipio(ceuta, elegida, obs, [elegida], estados);

    expect(salida.representaAlMunicipio).toBe(false);
    expect(salida.advertencia).toContain("Tarifa".toUpperCase());
    expect(salida.unidades["viento.velocidad"]).toContain("km/h");
    // 2,5 m/s convertidos: la observación ya no habla otra unidad que la predicción.
    expect(salida.viento).toEqual({ velocidad: 9, direccion: "E", direccionGrados: 92 });
    // La fecha sale con offset explícito, no desnuda.
    expect(salida.fecha).toBe("2026-09-08T07:00:00+00:00");
  });

  it("distingue las candidatas comprobadas de las que ni se miraron", () => {
    // "sin datos" en una estación que no se llegó a consultar sería mentira: se
    // para en la primera que responde.
    const a = estacion({ idema: "5000A", distanciaKm: 1.5 });
    const b = estacion({ idema: "5000C", distanciaKm: 29.7 });
    const c = estacion({ idema: "5001X", distanciaKm: 40 });
    const estados = new Map<string, EstadoCandidata>([
      ["5000A", "sin datos"],
      ["5000C", "con datos"],
    ]);
    const salida = aSalidaObservacionMunicipio(ceuta, b, obs, [a, b, c], estados);

    expect(salida.candidatas.map((x) => x.estado)).toEqual([
      "sin datos",
      "con datos",
      "no consultada",
    ]);
  });
});

describe("notaNombreCompartido", () => {
  it("declara que 'Madrid' se ha leído como el municipio", () => {
    const nota = notaNombreCompartido("Madrid", madrid)!;
    expect(nota).toContain("MUNICIPIO");
    expect(nota).toContain("Comunidad de Madrid");
    expect(nota).toContain("avisos");
  });

  it("no dice nada donde no hay ambigüedad", () => {
    const alcobendas = municipioPorCodigo("28006")!;
    expect(notaNombreCompartido("Alcobendas", alcobendas)).toBeNull();
    // Con código INE tampoco: quien lo escribe ya ha elegido.
    expect(notaNombreCompartido("28079", madrid)).toBeNull();
  });

  it("calla en Ceuta y Melilla, donde municipio y comunidad son lo mismo", () => {
    // Son municipio, provincia y ciudad autónoma a la vez: no hay dos lecturas.
    expect(notaNombreCompartido("Ceuta", ceuta)).toBeNull();
    expect(notaNombreCompartido("Melilla", municipioPorCodigo("52001")!)).toBeNull();
  });

  it("avisa también con los nombres que son de provincia", () => {
    const sevilla = municipioPorCodigo("41091")!;
    const nota = notaNombreCompartido("Sevilla", sevilla);
    expect(nota).toContain("provincia de Sevilla");
  });
});

describe("seleccionarDias", () => {
  const dias = [
    { fecha: "2026-09-08T00:00:00" },
    { fecha: "2026-09-09T00:00:00" },
    { fecha: "2026-09-12T00:00:00" },
    { fecha: "2026-09-13T00:00:00" },
  ];

  it("acota por rango, que es lo que pide 'este fin de semana'", () => {
    const finde = seleccionarDias(dias, { desde: "2026-09-12", hasta: "2026-09-13" });
    expect(finde.map((d) => d.fecha.slice(0, 10))).toEqual(["2026-09-12", "2026-09-13"]);
  });

  it("los extremos son inclusivos", () => {
    expect(seleccionarDias(dias, { desde: "2026-09-09", hasta: "2026-09-09" })).toHaveLength(1);
  });

  it("combina rango y número máximo", () => {
    expect(seleccionarDias(dias, { desde: "2026-09-09", max: 2 })).toHaveLength(2);
  });

  it("un rango vacío devuelve vacío en vez de todo", () => {
    // Devolver los siete días sería peor que no devolver nada: el modelo
    // presentaría fechas que no se pidieron como si fueran las pedidas.
    expect(seleccionarDias(dias, { desde: "2027-01-01" })).toEqual([]);
  });

  it("sin opciones no toca nada", () => {
    expect(seleccionarDias(dias)).toHaveLength(4);
  });
});
