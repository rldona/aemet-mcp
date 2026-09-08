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
  /** Grados decimales; negativo al oeste. `undefined` si el inventario no la trae. */
  latitud?: number;
  longitud?: number;
  /** Metros sobre el nivel del mar. */
  altitud?: number;
}

/**
 * Convierte las coordenadas del inventario a grados decimales.
 *
 * AEMET las publica como DMS empaquetado con el hemisferio pegado al final:
 * "402441N" son 40°24'41" N y "034040W" son 3°40'40" W (verificado contra
 * Madrid-Retiro, 40.4114 / -3.6778). Los grados son lo que quede por la
 * izquierda tras separar los dos dígitos de segundos y los dos de minutos, así
 * que el mismo parser vale para latitud y longitud.
 */
export function parseCoordenadaDMS(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /^(\d+)([NSEWO])$/i.exec(raw.trim());
  if (!m) return undefined;
  const digitos = m[1]!;
  if (digitos.length < 5) return undefined;

  const segundos = Number(digitos.slice(-2));
  const minutos = Number(digitos.slice(-4, -2));
  const grados = Number(digitos.slice(0, -4));
  if (!Number.isFinite(grados) || !Number.isFinite(minutos) || !Number.isFinite(segundos)) {
    return undefined;
  }
  // AEMET publica valores con 60 segundos ("364460N" son 36º44'60\", es decir
  // 36º45'00\"): un acarreo sin normalizar, no un dato corrupto. La suma de
  // abajo lo resuelve sola, así que se aceptan; por encima de 60 sí es basura.
  if (minutos > 60 || segundos > 60) return undefined;

  const valor = grados + minutos / 60 + segundos / 3600;
  const hemisferio = m[2]!.toUpperCase();
  // "O" (oeste en español) aparece en algunos registros además de "W".
  return hemisferio === "S" || hemisferio === "W" || hemisferio === "O" ? -valor : valor;
}

/** Distancia en km entre dos puntos (fórmula del haversine). */
export function distanciaKm(
  a: { latitud: number; longitud: number },
  b: { latitud: number; longitud: number },
): number {
  const R = 6371; // radio medio terrestre en km
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.latitud - a.latitud);
  const dLon = rad(b.longitud - a.longitud);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
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
  return {
    idema: e.indicativo,
    nombre: e.nombre,
    provincia: e.provincia,
    latitud: parseCoordenadaDMS(e.latitud),
    longitud: parseCoordenadaDMS(e.longitud),
    altitud: e.altitud !== undefined ? Number(e.altitud) : undefined,
  };
}

/** Descarga (y cachea 24 h) el inventario completo de estaciones. */
export async function inventarioEstaciones(
  client: AemetClient,
): Promise<EstacionResuelta[]> {
  const inventario = await client.fetchJson<EstacionInventario[]>(
    INVENTARIO_PATH,
    TTL.inventario,
  );
  return inventario.map(toResuelta);
}

/**
 * Busca estaciones por idema, nombre o provincia. A diferencia de
 * `resolverEstacion`, no exige que la respuesta sea única: devuelve candidatos
 * para que quien llame elija.
 */
export async function buscarEstaciones(
  client: AemetClient,
  consulta: string,
  limite = 20,
): Promise<EstacionResuelta[]> {
  const estaciones = await inventarioEstaciones(client);
  const q = normalize(consulta);
  if (!q) return [];

  const exactas: EstacionResuelta[] = [];
  const empiezan: EstacionResuelta[] = [];
  const contienen: EstacionResuelta[] = [];

  for (const e of estaciones) {
    const nombre = normalize(e.nombre);
    const provincia = normalize(e.provincia ?? "");
    if (e.idema.toLowerCase() === consulta.trim().toLowerCase() || nombre === q) {
      exactas.push(e);
    } else if (nombre.startsWith(q) || provincia === q) {
      empiezan.push(e);
    } else if (nombre.includes(q) || provincia.includes(q)) {
      contienen.push(e);
    }
  }

  const porNombre = (a: EstacionResuelta, b: EstacionResuelta) =>
    a.nombre.localeCompare(b.nombre, "es");
  exactas.sort(porNombre);
  empiezan.sort(porNombre);
  contienen.sort(porNombre);

  return [...exactas, ...empiezan, ...contienen].slice(0, limite);
}

/** Estaciones con coordenadas, ordenadas por cercanía a un punto. */
export async function estacionesCercanas(
  client: AemetClient,
  punto: { latitud: number; longitud: number },
  limite = 5,
): Promise<Array<EstacionResuelta & { distanciaKm: number }>> {
  const estaciones = await inventarioEstaciones(client);
  return estaciones
    .filter(
      (e): e is EstacionResuelta & { latitud: number; longitud: number } =>
        e.latitud !== undefined && e.longitud !== undefined,
    )
    .map((e) => ({ ...e, distanciaKm: distanciaKm(punto, e) }))
    .sort((a, b) => a.distanciaKm - b.distanciaKm)
    .slice(0, limite);
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
