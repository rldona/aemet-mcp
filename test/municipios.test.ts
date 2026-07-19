import { describe, it, expect } from "vitest";
import {
  normalize,
  buscarMunicipios,
  resolverMunicipio,
  municipioPorCodigo,
  esCodigoINE,
  totalMunicipios,
} from "../src/aemet/municipios.js";

describe("dataset de municipios", () => {
  it("bundlea el padrón completo del INE (>8000)", () => {
    expect(totalMunicipios()).toBeGreaterThan(8000);
  });

  it("resuelve códigos INE conocidos", () => {
    expect(municipioPorCodigo("28079")?.nombre).toBe("Madrid");
    expect(municipioPorCodigo("08019")?.nombre).toBe("Barcelona");
  });
});

describe("normalize", () => {
  it("es tolerante a acentos y mayúsculas", () => {
    expect(normalize("MÁLAGA")).toBe("malaga");
    expect(normalize("A Coruña")).toBe("a coruna");
    expect(normalize("  Sant  Cugat  ")).toBe("sant cugat");
  });
});

describe("buscarMunicipios", () => {
  it("encuentra por nombre sin acentos", () => {
    const r = buscarMunicipios("malaga");
    expect(r.some((m) => m.codigo === "29067")).toBe(true);
  });

  it("prioriza coincidencia exacta sobre parcial", () => {
    const r = buscarMunicipios("leon");
    expect(r[0]?.nombre.toLowerCase()).toContain("león".toLowerCase());
  });

  it("devuelve vacío para entrada vacía", () => {
    expect(buscarMunicipios("   ")).toEqual([]);
  });
});

describe("esCodigoINE", () => {
  it("reconoce códigos de 5 dígitos", () => {
    expect(esCodigoINE("28079")).toBe(true);
    expect(esCodigoINE("2807")).toBe(false);
    expect(esCodigoINE("madrid")).toBe(false);
  });
});

describe("resolverMunicipio", () => {
  it("resuelve por código", () => {
    expect(resolverMunicipio("28079").nombre).toBe("Madrid");
  });

  it("resuelve nombre único (case/acento insensible)", () => {
    expect(resolverMunicipio("madrid").codigo).toBe("28079");
  });

  it("lanza error informativo para código inexistente", () => {
    expect(() => resolverMunicipio("99999")).toThrow(/No existe/);
  });

  it("lanza error para nombre sin coincidencias", () => {
    expect(() => resolverMunicipio("xyzabc123")).toThrow(/No se encontró/);
  });
});
