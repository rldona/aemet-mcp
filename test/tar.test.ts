import { describe, it, expect } from "vitest";
import { readOctal, untar } from "../src/aemet/tar.js";

const BLOQUE = 512;
const enc = new TextEncoder();

interface Entrada {
  name: string;
  content: string;
  /** typeflag: "0" fichero regular (por defecto), "5" directorio. */
  tipo?: string;
}

/** Construye un tar mínimo válido (sin checksum: untar no lo exige). */
function makeTar(files: Entrada[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const header = new Uint8Array(BLOQUE);
    header.set(enc.encode(f.name).subarray(0, 100), 0);
    const body = enc.encode(f.content);
    header.set(enc.encode(body.length.toString(8).padStart(11, "0")), 124);
    header[156] = (f.tipo ?? "0").charCodeAt(0);
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(body.length / BLOQUE) * BLOQUE);
    padded.set(body, 0);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(BLOQUE)); // bloque de ceros final
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

describe("untar", () => {
  it("extrae los ficheros regulares", () => {
    const tar = makeTar([
      { name: "a.xml", content: "<a/>" },
      { name: "b.xml", content: "<b/>" },
    ]);
    const entries = untar(tar);
    expect(entries.map((e) => e.name)).toEqual(["a.xml", "b.xml"]);
    expect(new TextDecoder().decode(entries[0]!.content)).toBe("<a/>");
  });

  it("ignora los directorios", () => {
    const tar = makeTar([
      { name: "dir/", content: "", tipo: "5" },
      { name: "dir/a.xml", content: "<a/>" },
    ]);
    expect(untar(tar).map((e) => e.name)).toEqual(["dir/a.xml"]);
  });

  it("rechaza un tar truncado en lugar de devolver contenido cortado", () => {
    const tar = makeTar([{ name: "grande.xml", content: "x".repeat(600) }]);
    // Se corta el cuerpo a la mitad: la cabecera sigue declarando 600 bytes.
    const truncado = tar.subarray(0, BLOQUE + 300);

    expect(() => untar(truncado)).toThrowError(
      expect.objectContaining({ code: "PARSE" }),
    );
    expect(() => untar(truncado)).toThrowError(/truncado/i);
  });

  it("rechaza una cabecera con el tamaño corrupto", () => {
    const tar = makeTar([{ name: "a.xml", content: "<a/>" }]);
    tar.set(enc.encode("9x9"), 124); // '9' y 'x' no son dígitos octales

    expect(() => untar(tar)).toThrowError(
      expect.objectContaining({ code: "PARSE" }),
    );
    expect(() => untar(tar)).toThrowError(/corrupta/i);
  });

  it("rechaza el tamaño en formato GNU base-256, que no soportamos", () => {
    const tar = makeTar([{ name: "a.xml", content: "<a/>" }]);
    tar[124] = 0x80; // bit alto: codificación base-256

    expect(() => untar(tar)).toThrowError(
      expect.objectContaining({ code: "PARSE" }),
    );
  });

  it("aplica el tope de número de entradas", () => {
    const tar = makeTar([
      { name: "a.xml", content: "a" },
      { name: "b.xml", content: "b" },
      { name: "c.xml", content: "c" },
    ]);
    expect(() => untar(tar, { maxEntries: 2 })).toThrowError(
      expect.objectContaining({ code: "PARSE" }),
    );
    expect(untar(tar, { maxEntries: 3 })).toHaveLength(3);
  });

  it("aplica el tope de bytes extraídos", () => {
    const tar = makeTar([{ name: "a.xml", content: "x".repeat(2000) }]);
    expect(() => untar(tar, { maxTotalBytes: 1000 })).toThrowError(
      expect.objectContaining({ code: "PARSE" }),
    );
  });

  it("un buffer vacío o solo con el bloque final devuelve cero entradas", () => {
    expect(untar(new Uint8Array(0))).toEqual([]);
    expect(untar(new Uint8Array(BLOQUE))).toEqual([]);
  });
});

describe("readOctal", () => {
  /** Coloca `s` en un bloque de 512 bytes en el offset del campo tamaño. */
  function campo(s: string): Uint8Array {
    const b = new Uint8Array(BLOQUE);
    b.set(enc.encode(s), 124);
    return b;
  }

  it("lee un valor octal normal", () => {
    expect(readOctal(campo("00000000144"), 124, 12)).toBe(100); // 0o144
  });

  it("un campo vacío es tamaño cero, no un error", () => {
    expect(readOctal(new Uint8Array(BLOQUE), 124, 12)).toBe(0);
  });

  it("un campo con dígitos no octales es corrupto (null)", () => {
    expect(readOctal(campo("00000000899"), 124, 12)).toBeNull();
    expect(readOctal(campo("basura"), 124, 12)).toBeNull();
  });

  it("distingue campo vacío de campo corrupto", () => {
    // El fallo original: ambos casos devolvían 0 y el recorrido seguía
    // desalineado sobre bytes arbitrarios en lugar de abortar.
    expect(readOctal(new Uint8Array(BLOQUE), 124, 12)).toBe(0);
    expect(readOctal(campo("9"), 124, 12)).toBeNull();
  });
});
