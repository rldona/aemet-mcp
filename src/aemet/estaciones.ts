import type { AemetClient } from "./client.js";
import { TTL } from "./client.js";
import { normalize } from "./municipios.js";
import type { EstacionInventario } from "./types.js";

const INVENTARIO_PATH =
  "/valores/climatologicos/inventarioestaciones/todasestaciones";

/** ¿Parece un identificador de estación (idema) más que un nombre? */
export function pareceIdema(s: string): boolean {
  return /^[0-9][0-9A-Za-z]{2,4}$/.test(s.trim());
}

export interface EstacionResuelta {
  idema: string;
  nombre: string;
  provincia?: string;
}

/**
 * Resuelve la entrada del usuario (idema o nombre) a una estación concreta,
 * usando el inventario de estaciones de AEMET (cacheado ~24 h).
 *
 * - Si es un idema válido presente en el inventario, se usa directo.
 * - Si es un nombre, se hace match tolerante a acentos/mayúsculas.
 * - Si es ambiguo o no existe, se lanza un error con opciones.
 */
export async function resolverEstacion(
  client: AemetClient,
  entrada: string,
): Promise<EstacionResuelta> {
  const inventario = await client.fetchJson<EstacionInventario[]>(
    INVENTARIO_PATH,
    TTL.inventario,
  );
  const raw = entrada.trim();

  // 1) Coincidencia directa por idema (indicativo).
  if (pareceIdema(raw)) {
    const est = inventario.find(
      (e) => e.indicativo?.toUpperCase() === raw.toUpperCase(),
    );
    if (est) return toResuelta(est);
    // Si parece idema pero no existe, seguimos probando por nombre.
  }

  // 2) Match por nombre (exacto normalizado > contiene).
  const q = normalize(raw);
  const exactas = inventario.filter((e) => normalize(e.nombre) === q);
  if (exactas.length === 1) return toResuelta(exactas[0]!);
  if (exactas.length > 1) throw ambiguo(raw, exactas);

  const contiene = inventario
    .filter((e) => normalize(e.nombre).includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  if (contiene.length === 0) {
    throw new Error(
      `No se encontró ninguna estación que coincida con "${raw}". ` +
        `Prueba con el nombre de una ciudad grande o un identificador idema (p. ej. 3195 = Madrid-Retiro).`,
    );
  }
  if (contiene.length === 1) return toResuelta(contiene[0]!);
  throw ambiguo(raw, contiene.slice(0, 10));
}

function toResuelta(e: EstacionInventario): EstacionResuelta {
  return { idema: e.indicativo, nombre: e.nombre, provincia: e.provincia };
}

function ambiguo(entrada: string, opciones: EstacionInventario[]): Error {
  const lista = opciones
    .slice(0, 10)
    .map((e) => `  - ${e.nombre} (${e.indicativo})`)
    .join("\n");
  return new Error(
    `"${entrada}" coincide con varias estaciones:\n${lista}\n` +
      `Vuelve a llamar indicando el identificador idema exacto.`,
  );
}
