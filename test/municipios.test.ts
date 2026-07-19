import { describe, it, expect } from "vitest";
import {
  normalize,
  buscarMunicipios,
  resolverMunicipio,
  municipioPorCodigo,
  esCodigoINE,
  totalMunicipios,
  etiquetaMunicipio,
  nombreNatural,
  variantesNombre,
} from "../src/aemet/municipios.js";
import { PROVINCIAS } from "../src/aemet/provincias.js";

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

// ---------------------------------------------------------------------------
// Provincia derivada del código INE (ticket 15)
// ---------------------------------------------------------------------------

describe("provincia de los municipios", () => {
  it("todos los municipios del dataset tienen provincia conocida", () => {
    // Si el dataset incorporase un prefijo nuevo, la tabla de 52 provincias se
    // quedaría corta y aquí saldría el fallback "—".
    const sinProvincia = buscarMunicipios("a", 100000).filter((m) => m.provincia === "—");
    expect(sinProvincia).toEqual([]);
  });

  it("deriva la provincia del prefijo del código INE", () => {
    expect(municipioPorCodigo("28079")?.provincia).toBe("Madrid");
    expect(municipioPorCodigo("15030")?.provincia).toBe("A Coruña");
    expect(municipioPorCodigo("03050")?.provincia).toBe("Alicante");
    expect(municipioPorCodigo("38038")?.provincia).toBe("Santa Cruz de Tenerife");
    expect(municipioPorCodigo("51001")?.provincia).toBe("Ceuta");
  });

  it("la tabla de provincias cubre exactamente los prefijos del dataset", () => {
    const prefijos = new Set(
      Object.keys(PROVINCIAS).filter((c) => c in PROVINCIAS),
    );
    expect(prefijos.size).toBe(52);
  });

  it("la etiqueta desambigua con provincia y código INE", () => {
    const m = municipioPorCodigo("28079")!;
    expect(etiquetaMunicipio(m)).toBe("Madrid (Madrid) — código INE 28079");
  });

  it("los homónimos se distinguen por provincia", () => {
    const zarzas = buscarMunicipios("Zarza", 20);
    const provincias = new Set(zarzas.map((m) => m.provincia));
    expect(provincias.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Nombres naturales y artículos invertidos (ticket 16)
// ---------------------------------------------------------------------------

describe("nombreNatural", () => {
  it("antepone el artículo pospuesto", () => {
    expect(nombreNatural("Campello, el")).toBe("el Campello");
    expect(nombreNatural("Coruña, A")).toBe("A Coruña");
    expect(nombreNatural("Palmas de Gran Canaria, Las")).toBe("Las Palmas de Gran Canaria");
  });

  it("junta el artículo apostrofado sin espacio", () => {
    expect(nombreNatural("Atzúbia, l'")).toBe("l'Atzúbia");
  });

  it("naturaliza cada alternativa lingüística por separado", () => {
    expect(nombreNatural("Camp de Mirra, el/Campo de Mirra")).toBe(
      "el Camp de Mirra/Campo de Mirra",
    );
  });

  it("no toca lo que hay tras una coma si no es un artículo", () => {
    // Hay nombres del INE con coma que no llevan artículo detrás.
    expect(nombreNatural("Castell-Platja d'Aro, Platja d'Aro i s'Agaró")).toBe(
      "Castell-Platja d'Aro, Platja d'Aro i s'Agaró",
    );
  });

  it("deja igual los nombres sin artículo pospuesto", () => {
    expect(nombreNatural("Madrid")).toBe("Madrid");
    expect(nombreNatural("San Sebastián de los Reyes")).toBe("San Sebastián de los Reyes");
  });
});

describe("variantesNombre", () => {
  it("separa formas principales de la base sin artículo", () => {
    const v = variantesNombre("Campello, el");
    expect(v.principales.sort()).toEqual(["Campello, el", "el Campello"].sort());
    expect(v.secundarias).toEqual(["Campello"]);
  });

  it("cubre las dos lenguas de un nombre con barra", () => {
    expect(variantesNombre("Ayala/Aiara").principales.sort()).toEqual(
      ["Aiara", "Ayala"].sort(),
    );
  });

  it("un nombre sin artículo no genera secundarias", () => {
    expect(variantesNombre("Madrid")).toEqual({
      principales: ["Madrid"],
      secundarias: [],
    });
  });
});

describe("resolverMunicipio con nombres naturales", () => {
  const casos: Array<[string, string]> = [
    ["El Campello", "03050"],
    ["el campello", "03050"],
    ["Campello", "03050"],
    ["Campello, el", "03050"], // forma del INE: sigue funcionando
    ["A Coruña", "15030"],
    ["Coruña, A", "15030"],
    ["Las Palmas de Gran Canaria", "35016"],
    ["Madrid", "28079"], // sin artículo: no hay regresión
    ["Granada", "18087"], // no lo roba la base de "La Granada" (Barcelona)
    ["La Granada", "08094"],
    ["Sevilla", "41091"],
    ["Barcelona", "08019"],
  ];

  for (const [entrada, codigo] of casos) {
    it(`"${entrada}" resuelve a ${codigo}`, () => {
      expect(resolverMunicipio(entrada).codigo).toBe(codigo);
    });
  }

  it("sigue resolviendo por código INE", () => {
    expect(resolverMunicipio("03050").nombreNatural).toBe("el Campello");
  });

  it('"La Zarza" encuentra los dos homónimos y pide desambiguar por provincia', () => {
    // Hay una Zarza en Badajoz y otra en Valladolid: lo correcto no es elegir
    // una, es decir cuáles son. Antes ni siquiera se encontraban, porque el INE
    // las guarda como "Zarza, La".
    expect(() => resolverMunicipio("La Zarza")).toThrowError(/es ambiguo/);
    expect(() => resolverMunicipio("La Zarza")).toThrowError(/Badajoz/);
    expect(() => resolverMunicipio("La Zarza")).toThrowError(/Valladolid/);

    const codigos = buscarMunicipios("La Zarza", 10).map((m) => m.codigo);
    expect(codigos).toContain("06162");
    expect(codigos).toContain("47232");
  });
});
