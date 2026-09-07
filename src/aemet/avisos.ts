import { gunzipSync } from "node:zlib";
import type { AemetClient } from "./client.js";
import { TtlCache } from "./cache.js";
import { AemetError } from "./errors.js";
import { untar, type UntarOptions } from "./tar.js";

export type NivelAviso = "amarillo" | "naranja" | "rojo";

/** Un aviso meteorológico ya parseado y filtrado (vigente, no verde). */
export interface Aviso {
  nivel: NivelAviso;
  fenomeno: string;
  zona: string;
  onset?: string;
  expires?: string;
  descripcion?: string;
  probabilidad?: string;
}

export interface ResultadoAvisos {
  avisos: Aviso[];
  /** Fecha de elaboración (campo <sent> más reciente encontrado). */
  elaborado?: string;
}

const NIVEL_ORDEN: Record<NivelAviso, number> = { rojo: 3, naranja: 2, amarillo: 1 };

// Caché propia (los avisos se re-elaboran cada pocas horas; TTL 10 min).
const cache = new TtlCache<ResultadoAvisos>(10 * 60_000);

/** Tope por defecto de bytes descomprimidos. Un área CAP real ronda los cientos de KB. */
export const DEFAULT_MAX_DESCOMPRIMIDO = 64 * 1024 * 1024;

/**
 * Descomprime si viene en gzip; si `fetch` ya lo descomprimió, es un tar plano.
 *
 * `maxOutputLength` acota la expansión: sin él, un gzip de unos pocos KB puede
 * expandirse hasta agotar la memoria del proceso.
 */
function aTar(bytes: Uint8Array, maxBytes: number): Uint8Array {
  const esGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!esGzip) {
    if (bytes.byteLength > maxBytes) throw errorDemasiadoGrande(maxBytes);
    return bytes;
  }
  try {
    return new Uint8Array(gunzipSync(bytes, { maxOutputLength: maxBytes }));
  } catch (cause) {
    // Node lanza ERR_BUFFER_TOO_LARGE al superar maxOutputLength.
    if ((cause as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
      throw errorDemasiadoGrande(maxBytes);
    }
    throw new AemetError(
      "PARSE",
      `No se pudo descomprimir el fichero de avisos de AEMET: ${(cause as Error).message}`,
    );
  }
}

function errorDemasiadoGrande(maxBytes: number): AemetError {
  return new AemetError(
    "TOO_LARGE",
    `El fichero de avisos de AEMET supera el máximo descomprimido (${maxBytes} bytes).`,
  );
}

export interface ExtraerAvisosOptions extends UntarOptions {
  /** Tope de bytes tras descomprimir. Def: 64 MiB. */
  maxBytesDescomprimidos?: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]!.trim()) : undefined;
}

/** Valor de un <parameter> por su <valueName>. */
function parametro(infoXml: string, valueName: string): string | undefined {
  const re = new RegExp(
    `<valueName>${valueName}</valueName>\\s*<value>([\\s\\S]*?)</value>`,
  );
  const m = infoXml.match(re);
  return m ? decodeEntities(m[1]!.trim()) : undefined;
}

/**
 * Parsea un CAP XML a un Aviso. Devuelve null si:
 * - no es un aviso real (status != Actual),
 * - no tiene bloque en español,
 * - el nivel es verde (sin aviso),
 * - o ya expiró (no vigente en `now`).
 */
export function parseCapAlert(xml: string, now: number): Aviso | null {
  if (tag(xml, "status") && tag(xml, "status") !== "Actual") return null;

  // Bloque <info> en español (hay uno por idioma: es-ES, en-GB).
  const infoEs = (xml.match(/<info>[\s\S]*?<\/info>/g) ?? []).find((b) =>
    /<language>es-ES<\/language>/.test(b),
  );
  if (!infoEs) return null;

  const nivelRaw = parametro(infoEs, "AEMET-Meteoalerta nivel")?.toLowerCase();
  if (!nivelRaw || nivelRaw === "verde") return null;
  if (nivelRaw !== "amarillo" && nivelRaw !== "naranja" && nivelRaw !== "rojo") {
    return null;
  }

  const expires = tag(infoEs, "expires");
  if (expires) {
    const t = Date.parse(expires);
    if (Number.isFinite(t) && t <= now) return null; // ya no vigente
  }

  // Fenómeno: "AT;Temperaturas máximas" -> "Temperaturas máximas".
  const fenParam = parametro(infoEs, "AEMET-Meteoalerta fenomeno");
  const fenomeno = fenParam?.includes(";")
    ? fenParam.split(";").slice(1).join(";").trim()
    : (fenParam ?? tag(infoEs, "event") ?? "Fenómeno meteorológico");

  return {
    nivel: nivelRaw,
    fenomeno,
    zona: tag(infoEs, "areaDesc") ?? "—",
    onset: tag(infoEs, "onset"),
    expires,
    descripcion: tag(infoEs, "description"),
    probabilidad: parametro(infoEs, "AEMET-Meteoalerta probabilidad"),
  };
}

/** Extrae y ordena los avisos vigentes de un tar(.gz) de CAP. Función pura. */
export function extraerAvisos(
  bytes: Uint8Array,
  now: number,
  opts: ExtraerAvisosOptions = {},
): ResultadoAvisos {
  const tar = aTar(bytes, opts.maxBytesDescomprimidos ?? DEFAULT_MAX_DESCOMPRIMIDO);
  const files = untar(tar, opts).filter((f) => f.name.endsWith(".xml"));
  const avisos: Aviso[] = [];
  let elaborado: string | undefined;

  for (const f of files) {
    const xml = new TextDecoder("utf-8").decode(f.content);
    const sent = tag(xml, "sent");
    if (sent && (!elaborado || sent > elaborado)) elaborado = sent;

    const aviso = parseCapAlert(xml, now);
    if (aviso) avisos.push(aviso);
  }

  avisos.sort(
    (a, b) =>
      NIVEL_ORDEN[b.nivel] - NIVEL_ORDEN[a.nivel] ||
      a.fenomeno.localeCompare(b.fenomeno, "es") ||
      (a.onset ?? "").localeCompare(b.onset ?? "") ||
      a.zona.localeCompare(b.zona, "es"),
  );

  return { avisos, elaborado };
}

/** Clave estable de un aviso para deduplicar notificaciones ya enviadas. */
export function claveAviso(a: Aviso): string {
  return [a.nivel, a.fenomeno, a.zona, a.onset ?? "", a.expires ?? ""].join("|");
}

/** Obtiene los avisos vigentes de una CCAA (con caché). */
export async function obtenerAvisos(
  client: AemetClient,
  codigoArea: string,
  now: number = Date.now(),
): Promise<ResultadoAvisos> {
  return cache.getOrLoad(`avisos:${codigoArea}`, async () => {
    const bytes = await client.fetchDatosBytes(
      `/avisos_cap/ultimoelaborado/area/${codigoArea}`,
    );
    return extraerAvisos(bytes, now);
  });
}
