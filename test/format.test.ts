import { describe, it, expect } from "vitest";
import { formatDiaria } from "../src/aemet/format.js";
import type { PrediccionDiariaMunicipio } from "../src/aemet/types.js";

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
    expect(out).toContain("Viento: SO 15 km/h");
    expect(out).toContain("Humedad: 70 % / 20 %");
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
