import { describe, it, expect } from "vitest";
import { isoConOffset } from "../src/aemet/fechas.js";

describe("isoConOffset", () => {
  it("uniforma las cuatro convenciones que mezcla AEMET", () => {
    // Sin zona, declarada UTC (observación).
    expect(isoConOffset("2026-09-08T07:00:00", "UTC")).toBe("2026-09-08T07:00:00+00:00");
    // "+0000" sin dos puntos (observación en algunos nodos).
    expect(isoConOffset("2026-09-08T07:00:00+0000", "UTC")).toBe("2026-09-08T07:00:00+00:00");
    // "-00:00": es UTC, pero el RFC lo reserva para "zona desconocida".
    expect(isoConOffset("2026-09-08T07:00:00-00:00", "UTC")).toBe("2026-09-08T07:00:00+00:00");
    // Ya normalizado (avisos CAP): no se toca.
    expect(isoConOffset("2026-09-08T13:00:00+02:00", "UTC")).toBe("2026-09-08T13:00:00+02:00");
    // "Z".
    expect(isoConOffset("2026-09-08T07:00:00Z", "UTC")).toBe("2026-09-08T07:00:00+00:00");
  });

  it("no cambia el instante cuando la zona ya venía", () => {
    const original = "2026-01-15T13:00:00+01:00";
    const normalizado = isoConOffset(original, "UTC")!;
    expect(Date.parse(normalizado)).toBe(Date.parse(original));
  });

  it("aplica el horario de verano español a las fechas sin zona", () => {
    // Verano: CEST, +02:00.
    expect(isoConOffset("2026-09-08T07:15:12", "Europe/Madrid")).toBe(
      "2026-09-08T07:15:12+02:00",
    );
    // Invierno: CET, +01:00.
    expect(isoConOffset("2026-01-15T07:15:12", "Europe/Madrid")).toBe(
      "2026-01-15T07:15:12+01:00",
    );
  });

  it("acierta el desfase en los días del cambio de hora", () => {
    // En 2026 el cambio a verano en España es el 29 de marzo a las 02:00.
    expect(isoConOffset("2026-03-29T01:30:00", "Europe/Madrid")).toBe(
      "2026-03-29T01:30:00+01:00",
    );
    expect(isoConOffset("2026-03-29T04:30:00", "Europe/Madrid")).toBe(
      "2026-03-29T04:30:00+02:00",
    );
  });

  it("acepta segundos ausentes y el separador con espacio", () => {
    expect(isoConOffset("2026-09-08T07:00", "UTC")).toBe("2026-09-08T07:00:00+00:00");
    expect(isoConOffset("2026-09-08 07:00:00", "UTC")).toBe("2026-09-08T07:00:00+00:00");
  });

  it("devuelve null para lo ausente y el crudo para lo que no entiende", () => {
    expect(isoConOffset(undefined, "UTC")).toBeNull();
    expect(isoConOffset(null, "UTC")).toBeNull();
    expect(isoConOffset("", "UTC")).toBeNull();
    // Preferimos el dato tal cual a uno inventado.
    expect(isoConOffset("ayer por la tarde", "UTC")).toBe("ayer por la tarde");
  });
});
