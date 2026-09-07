// Geolocalización de municipios y geometría mínima.
//
// El dataset del INE bundleado solo trae código y nombre. Las coordenadas salen
// del maestro de municipios de AEMET (`/maestro/municipios`), que publica
// latitud y longitud ya en grados decimales, así que no hace falta empaquetar
// otro dataset ni convertir nada. Se cachea 24 h como el inventario: cambia una
// vez al año como mucho.

import type { AemetClient } from "./client.js";
import { TTL } from "./client.js";

const MAESTRO_PATH = "/maestro/municipios";

/** Punto en grados decimales. Longitud negativa al oeste. */
export interface Punto {
  latitud: number;
  longitud: number;
}

/** Entrada del maestro de municipios de AEMET (solo lo que usamos). */
interface MunicipioMaestro {
  /** "id28079": el código INE va detrás del prefijo "id". */
  id?: string;
  nombre?: string;
  latitud_dec?: string;
  longitud_dec?: string;
  altitud?: string;
}

/** Índice código INE -> punto, construido una vez por respuesta cacheada. */
const indices = new WeakMap<object, Map<string, Punto>>();

async function indiceCoordenadas(
  client: AemetClient,
): Promise<Map<string, Punto>> {
  const maestro = await client.fetchJson<MunicipioMaestro[]>(
    MAESTRO_PATH,
    TTL.inventario,
  );

  // El array cacheado es el mismo objeto entre llamadas, así que el índice se
  // construye una sola vez por ciclo de caché en lugar de en cada consulta.
  const cacheado = indices.get(maestro);
  if (cacheado) return cacheado;

  const mapa = new Map<string, Punto>();
  for (const m of maestro) {
    const codigo = (m.id ?? "").replace(/^id/, "");
    const latitud = Number(m.latitud_dec);
    const longitud = Number(m.longitud_dec);
    if (!/^\d{5}$/.test(codigo)) continue;
    if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) continue;
    mapa.set(codigo, { latitud, longitud });
  }
  indices.set(maestro, mapa);
  return mapa;
}

/**
 * Coordenadas de un municipio por su código INE de 5 dígitos.
 *
 * Devuelve `undefined` si AEMET no lo tiene: su maestro trae ~8.122 municipios
 * y el dataset del INE 8.132, así que unos pocos no cuadran.
 */
export async function coordenadasMunicipio(
  client: AemetClient,
  codigoINE: string,
): Promise<Punto | undefined> {
  const indice = await indiceCoordenadas(client);
  return indice.get(codigoINE.trim());
}

/**
 * ¿Está el punto dentro del polígono? Algoritmo de lanzamiento de rayo.
 *
 * El polígono es una lista de vértices [latitud, longitud] como los publica
 * AEMET en los avisos CAP. A escala de una zona de aviso la curvatura terrestre
 * es despreciable, así que se trabaja en coordenadas planas.
 */
export function puntoEnPoligono(punto: Punto, poligono: Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i]!;
    const b = poligono[j]!;
    const cruza = a.latitud > punto.latitud !== b.latitud > punto.latitud;
    if (!cruza) continue;
    const corte =
      ((b.longitud - a.longitud) * (punto.latitud - a.latitud)) /
        (b.latitud - a.latitud) +
      a.longitud;
    if (punto.longitud < corte) dentro = !dentro;
  }
  return dentro;
}

/**
 * Parsea el contenido de un `<polygon>` de CAP: pares "lat,lon" separados por
 * espacios. Devuelve `[]` si no hay suficientes vértices para cerrar un área.
 */
export function parsePoligono(texto: string): Punto[] {
  const puntos: Punto[] = [];
  for (const par of texto.trim().split(/\s+/)) {
    const [lat, lon] = par.split(",");
    const latitud = Number(lat);
    const longitud = Number(lon);
    if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) continue;
    puntos.push({ latitud, longitud });
  }
  return puntos.length >= 3 ? puntos : [];
}
