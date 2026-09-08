import { describe, it, expect } from "vitest";
import { untar } from "../src/aemet/tar.js";
import { gzipSync } from "node:zlib";
import { parseCapAlert, extraerAvisos, avisosParaPunto } from "../src/aemet/avisos.js";
import type { Aviso } from "../src/aemet/avisos.js";
import { resolverArea } from "../src/aemet/areas.js";

// --- helper: construye un tar mínimo válido (sin checksum; untar no lo exige) ---
function makeTar(files: Array<{ name: string; content: string }>): Uint8Array {
  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const f of files) {
    const header = new Uint8Array(512);
    const nameBytes = enc.encode(f.name);
    header.set(nameBytes.subarray(0, 100), 0);
    const body = enc.encode(f.content);
    const sizeOctal = body.length.toString(8).padStart(11, "0") + "\0";
    header.set(enc.encode(sizeOctal), 124);
    header[156] = "0".charCodeAt(0); // typeflag: fichero regular
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body, 0);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(512)); // bloque de ceros final
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

// --- helper: CAP XML de un aviso ---
function capXml(opts: {
  nivel: string;
  fenomeno?: string;
  zona?: string;
  expires: string;
  onset?: string;
  descripcion?: string;
  status?: string;
}): string {
  const fen = opts.fenomeno ?? "AT;Temperaturas máximas";
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <sent>2026-07-17T09:46:07-00:00</sent>
  <status>${opts.status ?? "Actual"}</status>
  <info>
    <language>es-ES</language>
    <event>Aviso de nivel ${opts.nivel}</event>
    <onset>${opts.onset ?? "2026-07-18T13:00:00+02:00"}</onset>
    <expires>${opts.expires}</expires>
    <description>${opts.descripcion ?? "Temperatura máxima: 39 ºC."}</description>
    <parameter><valueName>AEMET-Meteoalerta fenomeno</valueName><value>${fen}</value></parameter>
    <parameter><valueName>AEMET-Meteoalerta nivel</valueName><value>${opts.nivel}</value></parameter>
    <parameter><valueName>AEMET-Meteoalerta probabilidad</valueName><value>40%-70%</value></parameter>
    <area><areaDesc>${opts.zona ?? "Sierra y Pedroches"}</areaDesc></area>
  </info>
  <info>
    <language>en-GB</language>
    <event>Warning</event>
    <parameter><valueName>AEMET-Meteoalerta nivel</valueName><value>${opts.nivel}</value></parameter>
    <area><areaDesc>Sierra y Pedroches</areaDesc></area>
  </info>
</alert>`;
}

const FUTURO = "2999-01-01T00:00:00+02:00";
const PASADO = "2000-01-01T00:00:00+02:00";
const NOW = Date.parse("2026-07-19T10:00:00+02:00");

describe("untar", () => {
  it("extrae ficheros regulares con su contenido", () => {
    const tar = makeTar([
      { name: "a.xml", content: "<a>1</a>" },
      { name: "b.xml", content: "contenido más largo con acento é".repeat(30) },
    ]);
    const entries = untar(tar);
    expect(entries.map((e) => e.name)).toEqual(["a.xml", "b.xml"]);
    expect(new TextDecoder().decode(entries[0]!.content)).toBe("<a>1</a>");
  });
});

describe("parseCapAlert", () => {
  it("parsea un aviso amarillo vigente", () => {
    const a = parseCapAlert(capXml({ nivel: "amarillo", expires: FUTURO }), NOW);
    expect(a).not.toBeNull();
    expect(a!.nivel).toBe("amarillo");
    expect(a!.fenomeno).toBe("Temperaturas máximas");
    expect(a!.zona).toBe("Sierra y Pedroches");
    expect(a!.probabilidad).toBe("40%-70%");
  });

  it("descarta avisos verdes (sin aviso)", () => {
    expect(parseCapAlert(capXml({ nivel: "verde", expires: FUTURO }), NOW)).toBeNull();
  });

  it("descarta avisos ya expirados", () => {
    expect(parseCapAlert(capXml({ nivel: "naranja", expires: PASADO }), NOW)).toBeNull();
  });

  it("descarta status distinto de Actual (p. ej. Test)", () => {
    expect(
      parseCapAlert(capXml({ nivel: "rojo", expires: FUTURO, status: "Test" }), NOW),
    ).toBeNull();
  });

  it("conserva acentos del CAP (UTF-8)", () => {
    const a = parseCapAlert(
      capXml({ nivel: "naranja", expires: FUTURO, zona: "Cuenca del Genil" }),
      NOW,
    );
    expect(a!.descripcion).toContain("máxima");
  });
});

describe("extraerAvisos", () => {
  it("filtra verdes/expirados y ordena por nivel (rojo>naranja>amarillo)", () => {
    const tar = makeTar([
      { name: "1.xml", content: capXml({ nivel: "amarillo", expires: FUTURO, zona: "A" }) },
      { name: "2.xml", content: capXml({ nivel: "rojo", expires: FUTURO, zona: "B" }) },
      { name: "3.xml", content: capXml({ nivel: "verde", expires: FUTURO, zona: "C" }) },
      { name: "4.xml", content: capXml({ nivel: "naranja", expires: PASADO, zona: "D" }) },
      { name: "leeme.txt", content: "no es xml" },
    ]);
    const { avisos } = extraerAvisos(tar, NOW);
    expect(avisos.map((a) => a.nivel)).toEqual(["rojo", "amarillo"]);
    expect(avisos[0]!.zona).toBe("B");
  });

  it("devuelve lista vacía si no hay avisos vigentes", () => {
    const tar = makeTar([
      { name: "1.xml", content: capXml({ nivel: "verde", expires: FUTURO }) },
    ]);
    expect(extraerAvisos(tar, NOW).avisos).toEqual([]);
  });
});

describe("resolverArea", () => {
  it("resuelve por nombre, alias y código (mapa verificado contra la API)", () => {
    expect(resolverArea("Cataluña").codigo).toBe("69");
    expect(resolverArea("euskadi").codigo).toBe("75");
    expect(resolverArea("madrid").codigo).toBe("72");
    expect(resolverArea("61").nombre).toBe("Andalucía");
    // Regresión: 65 es Canarias (no Cantabria) y 78 es Ceuta (no Canarias).
    expect(resolverArea("Canarias").codigo).toBe("65");
    expect(resolverArea("Cantabria").codigo).toBe("66");
    expect(resolverArea("Ceuta").codigo).toBe("78");
  });

  it("lanza error claro para CCAA desconocida", () => {
    expect(() => resolverArea("Baviera")).toThrow(/No se reconoce/);
  });
});

// ---------------------------------------------------------------------------
// Descompresión acotada (ticket 3)
// ---------------------------------------------------------------------------

describe("extraerAvisos: tope de descompresión", () => {
  it("rechaza un gzip que se expande por encima del tope", () => {
    // Un tar de ceros comprime muchísimo: 512 KB -> unos pocos cientos de bytes.
    const tar = new Uint8Array(512 * 1024);
    const comprimido = new Uint8Array(gzipSync(tar));
    expect(comprimido.byteLength).toBeLessThan(tar.byteLength / 100);

    expect(() =>
      extraerAvisos(comprimido, Date.now(), { maxBytesDescomprimidos: 1024 }),
    ).toThrowError(expect.objectContaining({ code: "TOO_LARGE" }));
  });

  it("rechaza un tar plano que ya supera el tope", () => {
    expect(() =>
      extraerAvisos(new Uint8Array(4096), Date.now(), { maxBytesDescomprimidos: 1024 }),
    ).toThrowError(expect.objectContaining({ code: "TOO_LARGE" }));
  });

  it("acepta un tar.gz dentro del tope", () => {
    const tar = makeTar([
      {
        name: "Z_CAP_x.xml",
        content: capXml({ nivel: "amarillo", expires: "2099-01-01T00:00:00+02:00" }),
      },
    ]);
    const comprimido = new Uint8Array(gzipSync(tar));
    const res = extraerAvisos(comprimido, Date.now(), {
      maxBytesDescomprimidos: 1024 * 1024,
    });
    expect(res.avisos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Zonas y filtrado por punto (ticket 20)
// ---------------------------------------------------------------------------

/** CAP con varias <area>, cada una con su polígono y su código de zona. */
function capMultizona(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <sent>2026-09-07T09:00:00-00:00</sent>
  <status>Actual</status>
  <info>
    <language>es-ES</language>
    <event>Aviso</event>
    <onset>2026-09-07T13:00:00+02:00</onset>
    <expires>2099-01-01T00:00:00+02:00</expires>
    <description>Calor.</description>
    <parameter><valueName>AEMET-Meteoalerta fenomeno</valueName><value>AT;Temperaturas máximas</value></parameter>
    <parameter><valueName>AEMET-Meteoalerta nivel</valueName><value>amarillo</value></parameter>
    <area>
      <areaDesc>Zona norte</areaDesc>
      <polygon>40.0,-4.0 41.0,-4.0 41.0,-3.0 40.0,-3.0 40.0,-4.0</polygon>
      <geocode><valueName>AEMET-Meteoalerta zona</valueName><value>611801</value></geocode>
    </area>
    <area>
      <areaDesc>Zona sur</areaDesc>
      <polygon>37.0,-4.0 38.0,-4.0 38.0,-3.0 37.0,-3.0 37.0,-4.0</polygon>
      <geocode><valueName>AEMET-Meteoalerta zona</valueName><value>611802</value></geocode>
    </area>
  </info>
</alert>`;
}

describe("parseCapAlert: zonas", () => {
  it("recoge TODAS las zonas del aviso, no solo la primera", () => {
    // Un mismo CAP puede cubrir decenas de zonas; quedarse con la primera daba
    // una idea falsa del alcance territorial.
    const aviso = parseCapAlert(capMultizona(), Date.parse("2026-09-07T12:00:00Z"))!;
    expect(aviso.zonas.map((z) => z.descripcion)).toEqual(["Zona norte", "Zona sur"]);
    expect(aviso.zonas.map((z) => z.codigo)).toEqual(["611801", "611802"]);
    expect(aviso.zona).toBe("Zona norte"); // compatibilidad del texto de siempre
  });

  it("parsea los polígonos de cada zona", () => {
    const aviso = parseCapAlert(capMultizona(), Date.parse("2026-09-07T12:00:00Z"))!;
    expect(aviso.zonas[0]!.poligonos).toHaveLength(1);
    expect(aviso.zonas[0]!.poligonos[0]!.length).toBeGreaterThanOrEqual(4);
  });

  it("un aviso sin bloque area no rompe el parseo", () => {
    const aviso = parseCapAlert(
      capXml({ nivel: "amarillo", expires: "2099-01-01T00:00:00+02:00" }),
      Date.now(),
    );
    expect(aviso).not.toBeNull();
    expect(Array.isArray(aviso!.zonas)).toBe(true);
  });
});

describe("avisosParaPunto", () => {
  const aviso = () => parseCapAlert(capMultizona(), Date.parse("2026-09-07T12:00:00Z"))!;

  it("incluye el aviso si el punto cae en alguna de sus zonas", () => {
    const { dentro } = avisosParaPunto([aviso()], { latitud: 37.5, longitud: -3.5 });
    expect(dentro).toHaveLength(1);
    // Se conservan solo las zonas que realmente cubren el punto.
    expect(dentro[0]!.zonas.map((z) => z.descripcion)).toEqual(["Zona sur"]);
    expect(dentro[0]!.zona).toBe("Zona sur");
  });

  it("descarta el aviso si el punto queda fuera de todas sus zonas", () => {
    const { dentro, sinGeometria, fuera } = avisosParaPunto([aviso()], {
      latitud: 43.0,
      longitud: -8.0,
    });
    expect(dentro).toEqual([]);
    expect(sinGeometria).toEqual([]);
    expect(fuera).toHaveLength(1);
  });

  it("un aviso que cubre el punto NO aparece también en `fuera`", () => {
    // Los de `dentro` son copias acotadas a las zonas que cubren el punto, así
    // que restarlos por identidad de la lista original no funciona: el mismo
    // aviso salía a la vez como "te afecta" y como "no te afecta".
    const { dentro, fuera } = avisosParaPunto([aviso()], { latitud: 37.5, longitud: -3.5 });
    expect(dentro).toHaveLength(1);
    expect(fuera).toEqual([]);
  });

  it("reparte cada aviso en exactamente un grupo", () => {
    const avisos = [aviso(), aviso()];
    const { dentro, sinGeometria, fuera } = avisosParaPunto(avisos, {
      latitud: 37.5,
      longitud: -3.5,
    });
    expect(dentro.length + sinGeometria.length + fuera.length).toBe(avisos.length);
  });

  it("no descarta un aviso que no se puede evaluar por falta de geometría", () => {
    // Ocultar en silencio un aviso porque no sabemos dibujarlo es peor que
    // mostrarlo de más: se devuelve aparte para que quien llame lo diga.
    const sinPoligono: Aviso = {
      ...aviso(),
      zonas: [{ descripcion: "Zona sin contorno", poligonos: [] }],
    };
    const { dentro, sinGeometria } = avisosParaPunto([sinPoligono], {
      latitud: 43.0,
      longitud: -8.0,
    });
    expect(dentro).toEqual([]);
    expect(sinGeometria).toHaveLength(1);
  });
});
