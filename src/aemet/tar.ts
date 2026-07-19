// Extractor de tar mínimo, sin dependencias. El formato tar es una secuencia de
// bloques de 512 bytes: cabecera + contenido (con padding a 512). Solo nos
// interesan los ficheros regulares (los avisos CAP son .xml planos).

export interface TarEntry {
  name: string;
  content: Uint8Array;
}

function readString(block: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && block[i] !== 0; i++) {
    s += String.fromCharCode(block[i]!);
  }
  return s;
}

/** Lee un número en octal (formato de tamaño/campos numéricos del tar). */
function readOctal(block: Uint8Array, start: number, len: number): number {
  let s = "";
  for (let i = start; i < start + len; i++) {
    const c = block[i]!;
    if (c === 0 || c === 32) break; // NUL o espacio terminan el campo
    s += String.fromCharCode(c);
  }
  const n = parseInt(s.trim(), 8);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extrae las entradas de fichero regular de un buffer tar (ya descomprimido).
 * Ignora directorios y tipos especiales; soporta nombres < 100 chars (suficiente
 * para los ficheros CAP de AEMET, tipo Z_CAP_...xml).
 */
export function untar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);

    const name = readString(header, 0, 100);
    if (name === "") break; // bloque de ceros -> fin del archivo

    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156]!);
    offset += 512;

    if (size > 0) {
      // typeflag '0' o NUL = fichero regular.
      if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
        entries.push({ name, content: buf.subarray(offset, offset + size) });
      }
      offset += Math.ceil(size / 512) * 512;
    }
  }
  return entries;
}
