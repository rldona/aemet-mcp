// Nombres que son a la vez de municipio y de algo más grande.
//
// "Madrid" es un municipio, una provincia y una comunidad autónoma. Al pedir los
// avisos de "Madrid" el servidor elegía el municipio 28079 en silencio: una
// elección razonable, pero que nadie declaraba. Quien preguntaba por la región
// recibía los avisos de la capital creyendo que eran los de toda la comunidad.
//
// Esto no cambia la elección —el municipio sigue siendo la lectura por defecto,
// que es la que acierta casi siempre— pero la dice en voz alta y explica cómo
// pedir la otra.

import { AREAS, areaParaMunicipio } from "./areas.js";
import { PROVINCIAS } from "./provincias.js";
import { municipiosDeProvincia } from "./municipios.js";
import { normalize } from "./texto.js";
import type { Municipio } from "./types.js";

const AREA_POR_NOMBRE = new Map<string, string>();
for (const area of AREAS) {
  AREA_POR_NOMBRE.set(normalize(area.nombre), area.nombre);
  for (const alias of area.alias ?? []) AREA_POR_NOMBRE.set(normalize(alias), area.nombre);
}

const PROVINCIA_POR_NOMBRE = new Map<string, string>();
for (const nombre of Object.values(PROVINCIAS)) {
  PROVINCIA_POR_NOMBRE.set(normalize(nombre), nombre);
}

/**
 * Nota que aclara la interpretación cuando lo escrito nombra también a una
 * provincia o comunidad. `null` si no hay tal colisión, que es lo normal.
 *
 * Solo se activa si el usuario escribió el nombre (no un código) y ese nombre es
 * el del municipio elegido: "28079" o "Alcobendas" no tienen ambigüedad que
 * declarar.
 */
export function notaNombreCompartido(entrada: string, m: Municipio): string | null {
  const q = normalize(entrada);
  if (!q) return null;
  if (q !== normalize(m.nombreNatural) && q !== normalize(m.nombre)) return null;

  const comunidad = AREA_POR_NOMBRE.get(q);
  const provincia = PROVINCIA_POR_NOMBRE.get(q);
  if (!comunidad && !provincia) return null;

  // Ceuta y Melilla son municipio, provincia y ciudad autónoma a la vez: ahí no
  // hay dos lecturas que distinguir, y la nota solo sería ruido.
  if (municipiosDeProvincia(m.codigo).length === 1) return null;

  // La alternativa siempre es una comunidad: AEMET no publica avisos por
  // provincia. Si el nombre es de comunidad, esa; si es de provincia, la suya.
  const area = comunidad ?? areaParaMunicipio(m.codigo)?.nombre;
  const que = comunidad
    ? `la comunidad autónoma (${comunidad})`
    : `la provincia de ${provincia} (AEMET no publica avisos por provincia${area ? `, la unidad es ${area}` : ""})`;
  const como = area
    ? ` Para eso: herramienta \`avisos\` con area: "${area}".`
    : "";

  return (
    `Nota: "${entrada}" se ha interpretado como el MUNICIPIO de ` +
    `${m.nombreNatural} (${m.codigo}), no como ${que}.${como}`
  );
}
