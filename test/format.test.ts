import { describe, it, expect } from "vitest";
import {
  formatDiaria,
  formatObservacion,
  observacionMasReciente,
  probPrecipitacionDia,
} from "../src/aemet/format.js";
import type { Observacion, PrediccionDiariaMunicipio } from "../src/aemet/types.js";

const pred: PrediccionDiariaMunicipio = {
  nombre: "Madrid",
  provincia: "Madrid",
  elaborado: "2026-07-19T07:23:09",
  prediccion: {
    dia: [
      {
        fecha: "2026-07-19T00:00:00",
        temperatura: { maxima: 36, minima: 22 },
        humedadRelativa: { maxima: 70, minima: 20 },
        estadoCielo: [{ periodo: "00-24", descripcion: "Poco nuboso" }],
        probPrecipitacion: [{ periodo: "00-24", value: "0" }],
        viento: [{ periodo: "00-24", direccion: "SO", velocidad: 15 }],
        rachaMax: [{ periodo: "00-24", value: "30" }],
      },
    ],
  },
};

describe("formatDiaria", () => {
  it("incluye máx/mín, cielo, prob. precip, viento y humedad", () => {
    const out = formatDiaria(pred, 7);
    expect(out).toContain("Máx 36 °C / Mín 22 °C");
    expect(out).toContain("Cielo: Poco nuboso");
    expect(out).toContain("Prob. precip.: 0%");
    expect(out).toContain("Viento: SO 15 km/h (racha 30 km/h)");
    expect(out).toContain("Humedad: 70 % / 20 %");
  });

  it("omite la racha si AEMET la trae vacía", () => {
    const sinRacha: PrediccionDiariaMunicipio = {
      ...pred,
      prediccion: {
        dia: [{ ...pred.prediccion.dia[0]!, rachaMax: [{ periodo: "00-24", value: "" }] }],
      },
    };
    const out = formatDiaria(sinRacha, 7);
    expect(out).toContain("Viento: SO 15 km/h");
    expect(out).not.toContain("racha");
  });

  it("omite la humedad si AEMET no la trae", () => {
    const sinHr: PrediccionDiariaMunicipio = {
      ...pred,
      prediccion: { dia: [{ ...pred.prediccion.dia[0]!, humedadRelativa: undefined }] },
    };
    expect(formatDiaria(sinHr, 7)).not.toContain("Humedad:");
  });

  it("respeta el límite de días", () => {
    const dosDias: PrediccionDiariaMunicipio = {
      ...pred,
      prediccion: {
        dia: [
          pred.prediccion.dia[0]!,
          { ...pred.prediccion.dia[0]!, fecha: "2026-07-20T00:00:00" },
        ],
      },
    };
    const out = formatDiaria(dosDias, 1);
    expect(out).toContain("19/07");
    expect(out).not.toContain("20/07");
  });
});

// ---------------------------------------------------------------------------
// Selección de la observación más reciente (ticket 13)
// ---------------------------------------------------------------------------

describe("observacionMasReciente", () => {
  const obs = (idema: string, fint?: string, ta?: number) =>
    ({ idema, fint, ta }) as Observacion;

  it("elige por fint, no por posición en el array", () => {
    const registros = [
      obs("3195", "2026-09-07T10:00:00", 20),
      obs("3195", "2026-09-07T12:00:00", 26), // la más reciente, en medio
      obs("3195", "2026-09-07T11:00:00", 23),
    ];
    expect(observacionMasReciente(registros)?.ta).toBe(26);
  });

  it("sigue funcionando con el array en orden cronológico (caso real de AEMET)", () => {
    const registros = [
      obs("3195", "2026-09-07T10:00:00", 20),
      obs("3195", "2026-09-07T11:00:00", 23),
      obs("3195", "2026-09-07T12:00:00", 26),
    ];
    expect(observacionMasReciente(registros)?.ta).toBe(26);
  });

  it("ignora los registros sin fint o con fecha ilegible", () => {
    const registros = [
      obs("3195", "2026-09-07T12:00:00", 26),
      obs("3195", undefined, 99),
      obs("3195", "no-es-una-fecha", 98),
    ];
    expect(observacionMasReciente(registros)?.ta).toBe(26);
  });

  it("si ninguna fecha es usable, conserva el criterio anterior (la última)", () => {
    const registros = [obs("3195", undefined, 1), obs("3195", "basura", 2)];
    expect(observacionMasReciente(registros)?.ta).toBe(2);
  });

  it("con un array vacío devuelve undefined", () => {
    expect(observacionMasReciente([])).toBeUndefined();
  });

  it("formatObservacion muestra la hora del registro más reciente", () => {
    const registros = [
      obs("3195", "2026-09-07T10:00:00", 20),
      obs("3195", "2026-09-07T12:00:00", 26),
      obs("3195", "2026-09-07T11:00:00", 23),
    ];
    const texto = formatObservacion(registros, "Madrid, Retiro");
    expect(texto).toContain("2026-09-07T12:00:00");
    expect(texto).toContain("26 °C");
  });
});

// ---------------------------------------------------------------------------
// Agregación de la predicción diaria (ticket 14)
//
// Fixtures con las DOS formas reales que devuelve AEMET, capturadas el
// 2026-09-07 de Madrid (28079), A Coruña (15030) y Sevilla (41091); las tres
// coincidían. Ver docs/aemet-api-notes.md.
// ---------------------------------------------------------------------------

/** Días 0-3: agregado "00-24" + subperiodos de 12, 6 y 4 horas. */
const DIA_CON_PERIODOS: PrediccionDiariaMunicipio["prediccion"]["dia"][number] = {
  fecha: "2026-09-07T00:00:00",
  temperatura: { maxima: 31, minima: 17 },
  probPrecipitacion: [
    { value: 5, periodo: "00-24" },
    { value: 0, periodo: "00-12" },
    { value: 5, periodo: "12-24" },
    { value: 0, periodo: "00-06" },
    { value: 0, periodo: "06-12" },
    { value: 5, periodo: "12-18" },
    { value: 0, periodo: "18-24" },
  ],
  estadoCielo: [
    { value: "13", descripcion: "Intervalos nubosos", periodo: "00-24" },
    { value: "11", descripcion: "Despejado", periodo: "00-12" },
    { value: "13", descripcion: "Intervalos nubosos", periodo: "12-24" },
  ],
  viento: [
    { direccion: "NE", velocidad: 10, periodo: "00-24" },
    { direccion: "C", velocidad: 0, periodo: "00-12" },
  ],
  rachaMax: [{ value: "25", periodo: "00-24" }],
};

/** Días 4-6: un ÚNICO elemento SIN campo `periodo`, que es el día entero. */
const DIA_SIN_PERIODOS: PrediccionDiariaMunicipio["prediccion"]["dia"][number] = {
  fecha: "2026-09-11T00:00:00",
  temperatura: { maxima: 29, minima: 15 },
  probPrecipitacion: [{ value: 0 }],
  estadoCielo: [{ value: "11", descripcion: "Despejado" }],
  viento: [{ direccion: "C", velocidad: 0 }],
  rachaMax: [{ value: "" }],
};

describe("formatDiaria con las formas reales de AEMET", () => {
  const predReal: PrediccionDiariaMunicipio = {
    nombre: "Madrid",
    provincia: "Madrid",
    elaborado: "2026-09-07T10:00:00",
    prediccion: { dia: [DIA_CON_PERIODOS, DIA_SIN_PERIODOS] },
  };

  it("usa el agregado 00-24 cuando existe, no el primer subperiodo", () => {
    const texto = formatDiaria(predReal, 1);
    // El 00-24 vale 5%; el subperiodo 00-12 vale 0%. Si cogiera el primer
    // subperiodo por error, aquí saldría 0%.
    expect(texto).toContain("Prob. precip.: 5%");
    expect(texto).toContain("Intervalos nubosos");
    expect(texto).toContain("NE 10 km/h");
  });

  it("usa el único elemento sin periodo en los días lejanos", () => {
    const texto = formatDiaria(predReal, 2);
    expect(texto).toContain("Despejado");
    expect(texto).toContain("Máx 29 °C");
  });

  it("no rompe con probabilidad numérica (AEMET la manda como número)", () => {
    const texto = formatDiaria(predReal, 2);
    expect(texto).toContain("Prob. precip.: 0%");
  });
});

describe("probPrecipitacionDia", () => {
  it("prefiere el periodo 00-24", () => {
    expect(probPrecipitacionDia(DIA_CON_PERIODOS.probPrecipitacion)).toBe(5);
  });

  it("con un único elemento sin periodo, devuelve ese valor", () => {
    expect(probPrecipitacionDia(DIA_SIN_PERIODOS.probPrecipitacion)).toBe(0);
  });

  it("sin 00-24 y con varios subperiodos, devuelve el máximo del día", () => {
    // Caso defensivo: hoy AEMET no lo produce, pero coger el primero daría 0%
    // para un día con 80% de probabilidad por la tarde.
    const valor = probPrecipitacionDia([
      { value: 0, periodo: "00-12" },
      { value: 80, periodo: "12-24" },
    ]);
    expect(valor).toBe(80);
  });

  it("ignora valores no numéricos al buscar el máximo", () => {
    const valor = probPrecipitacionDia([
      { value: "", periodo: "00-12" },
      { value: 30, periodo: "12-24" },
    ]);
    expect(valor).toBe(30);
  });

  it("sin datos devuelve undefined", () => {
    expect(probPrecipitacionDia(undefined)).toBeUndefined();
    expect(probPrecipitacionDia([])).toBeUndefined();
  });
});
