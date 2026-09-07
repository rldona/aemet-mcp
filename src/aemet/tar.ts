// Extractor de tar mínimo, sin dependencias. El formato tar es una secuencia de
// bloques de 512 bytes: cabecera + contenido (con padding a 512). Solo nos
// interesan los ficheros regulares (los avisos CAP son .xml planos).
//
// El contenido viene de AEMET, así que el parser es defensivo: un tar truncado
// o con cabeceras corruptas se rechaza con un error explícito en lugar de
// devolver entradas cortadas que luego fallarían más lejos, al parsear el CAP.

import { AemetError } from "./errors.js";

export interface TarEntry {
  name: string;
  content: Uint8Array;
}

export interface UntarOptions {
  /** Máximo de entradas. Un área CAP trae decenas; 4096 es holgado. */
  maxEntries?: number;
  /** Máximo de bytes extraídos en total. */
  maxTotalBytes?: number;
}

export const DEFAULT_MAX_ENTRIES = 4096;
export const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const BLOQUE = 512;

function readString(block: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && block[i] !== 0; i++) {
    s += String.fromCharCode(block[i]!);
  }
  return s;
}

/**
 * Lee un número en octal (formato de tamaño/campos numéricos del tar).
 *
 * Devuelve `null` si el campo está corrupto, que es distinto de que esté vacío
 * (campo todo NUL, que algunos escritores usan para tamaño cero): confundir
 * ambos casos hacía que una cabecera basura se leyera como un fichero de 0
 * bytes y el recorrido siguiera desalineado sobre datos arbitrarios.
 */
export function readOctal(block: Uint8Array, start: number, len: number): number | null {
  // Codificación GNU base-256 (bit alto del primer byte): no la usamos y leerla
  // como octal daría un tamaño absurdo, así que se declara no soportada.
  if ((block[start]! & 0x80) !== 0) return null;

  let s = "";
  for (let i = start; i < start + len; i++) {
    const c = block[i]!;
    if (c === 0 || c === 32) break; // NUL o espacio terminan el campo
    s += String.fromCharCode(c);
  }
  const limpio = s.trim();
  if (limpio === "") return 0; // campo vacío: tamaño cero
  if (!/^[0-7]+$/.test(limpio)) return null; // campo corrupto
  const n = parseInt(limpio, 8);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** ¿Es un bloque entero de ceros (marca de fin de archivo)? */
function esBloqueVacio(buf: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + BLOQUE; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

/**
 * Extrae las entradas de fichero regular de un buffer tar (ya descomprimido).
 * Ignora directorios y tipos especiales; soporta nombres < 100 chars (suficiente
 * para los ficheros CAP de AEMET, tipo Z_CAP_...xml).
 *
 * Lanza `AemetError` con código `PARSE` si el tar está truncado, si una
 * cabecera tiene el tamaño corrupto o si se superan los límites de entradas o
 * de bytes extraídos.
 */
export function untar(buf: Uint8Array, opts: UntarOptions = {}): TarEntry[] {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

  const entries: TarEntry[] = [];
  let offset = 0;
  let totalBytes = 0;

  while (offset + BLOQUE <= buf.length) {
    if (esBloqueVacio(buf, offset)) break; // fin del archivo

    const header = buf.subarray(offset, offset + BLOQUE);
    const name = readString(header, 0, 100);
    if (name === "") break; // cabecera sin nombre: se trata como fin

    const size = readOctal(header, 124, 12);
    if (size === null) {
      throw new AemetError(
        "PARSE",
        `Tar de AEMET con cabecera corrupta: tamaño ilegible en la entrada "${name}".`,
      );
    }

    const typeflag = String.fromCharCode(header[156]!);
    offset += BLOQUE;

    if (size > 0) {
      if (offset + size > buf.length) {
        throw new AemetError(
          "PARSE",
          `Tar de AEMET truncado: la entrada "${name}" declara ${size} bytes ` +
            `pero solo quedan ${buf.length - offset}.`,
        );
      }

      // typeflag '0' o NUL = fichero regular.
      if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
        totalBytes += size;
        if (totalBytes > maxTotalBytes) {
          throw new AemetError(
            "PARSE",
            `El tar de AEMET supera el máximo de contenido extraído (${maxTotalBytes} bytes).`,
          );
        }
        if (entries.length >= maxEntries) {
          throw new AemetError(
            "PARSE",
            `El tar de AEMET supera el máximo de entradas (${maxEntries}).`,
          );
        }
        entries.push({ name, content: buf.subarray(offset, offset + size) });
      }
      offset += Math.ceil(size / BLOQUE) * BLOQUE;
    }
  }
  return entries;
}
