import { describe, it, expect } from "vitest";
import { untar } from "../src/aemet/tar.js";
import { parseCapAlert, extraerAvisos } from "../src/aemet/avisos.js";
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
