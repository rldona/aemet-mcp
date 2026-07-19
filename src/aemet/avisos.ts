import { gunzipSync } from "node:zlib";
import type { AemetClient } from "./client.js";
import { TtlCache } from "./cache.js";
import { untar } from "./tar.js";

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

/** Descomprime si viene en gzip; si `fetch` ya lo descomprimió, es un tar plano. */
function aTar(bytes: Uint8Array): Uint8Array {
  const esGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return esGzip ? new Uint8Array(gunzipSync(bytes)) : bytes;
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
export function extraerAvisos(bytes: Uint8Array, now: number): ResultadoAvisos {
  const files = untar(aTar(bytes)).filter((f) => f.name.endsWith(".xml"));
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
