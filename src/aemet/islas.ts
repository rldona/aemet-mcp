// Islas de Canarias y Baleares.
//
// Por qué existe esto: el INE no tiene concepto de isla. Un código de municipio
// dice provincia (35 Las Palmas, 38 Santa Cruz de Tenerife, 07 Illes Balears)
// pero no en qué isla está, y el nombre tampoco: "Valverde" es la capital de El
// Hierro y no lo dice por ningún lado. Sin esta tabla, preguntar por "El Hierro"
// devolvía un menú por subcadena —"Cueva del Hierro" (Cuenca), "El Pinar de El
// Hierro"— en el que faltaban dos de los tres municipios de la isla, porque no
// contienen la palabra.
//
// Cómo está construida: se enumeran las islas PEQUEÑAS por código y la grande de
// cada provincia es el resto. Así solo hay que acertar 36 códigos en vez de 155,
// y el recuento del resto se convierte en una comprobación: si Tenerife no sale
// 31, Gran Canaria 21 y Mallorca 53, algún código de arriba está mal. El test
// `islas.test.ts` lo verifica contra los totales conocidos.

import { normalize } from "./texto.js";

export interface Isla {
  nombre: string;
  /** Provincia INE a la que pertenece (2 dígitos). */
  provincia: string;
  /** Otras formas por las que se la conoce, ya en minúsculas y sin acentos. */
  alias?: string[];
}

/**
 * Islas enumeradas por código, con la grande de cada provincia como resto.
 *
 * El orden importa: dentro de una provincia, `resto` recoge todo lo que no haya
 * reclamado ninguna lista explícita.
 */
const DEFINICION: Array<{
  provincia: string;
  islas: Array<Isla & { codigos?: string[]; resto?: true }>;
}> = [
  {
    provincia: "38",
    islas: [
      {
        nombre: "El Hierro",
        provincia: "38",
        alias: ["hierro", "isla del hierro", "el meridiano"],
        codigos: ["38013", "38048", "38901"],
      },
      {
        nombre: "La Gomera",
        provincia: "38",
        alias: ["gomera", "isla de la gomera"],
        codigos: ["38002", "38003", "38021", "38036", "38049", "38050"],
      },
      {
        nombre: "La Palma",
        provincia: "38",
        // Ojo: "Palma" a secas es la ciudad de Mallorca, no esta isla.
        alias: ["isla de la palma", "san miguel de la palma", "isla bonita"],
        codigos: [
          "38007", "38008", "38009", "38014", "38016", "38024", "38027",
          "38029", "38030", "38033", "38037", "38045", "38047", "38053",
        ],
      },
      {
        nombre: "Tenerife",
        provincia: "38",
        alias: ["isla de tenerife"],
        resto: true,
      },
    ],
  },
  {
    provincia: "35",
    islas: [
      {
        nombre: "Lanzarote",
        provincia: "35",
        alias: ["isla de lanzarote"],
        codigos: ["35004", "35010", "35018", "35024", "35028", "35029", "35034"],
      },
      {
        nombre: "Fuerteventura",
        provincia: "35",
        alias: ["isla de fuerteventura"],
        codigos: ["35003", "35007", "35014", "35015", "35017", "35030"],
      },
      {
        nombre: "Gran Canaria",
        provincia: "35",
        alias: ["isla de gran canaria"],
        resto: true,
      },
    ],
  },
  {
    provincia: "07",
    islas: [
      {
        nombre: "Menorca",
        provincia: "07",
        alias: ["isla de menorca"],
        codigos: ["07002", "07015", "07023", "07032", "07037", "07052", "07064", "07902"],
      },
      {
        nombre: "Eivissa",
        provincia: "07",
        alias: ["ibiza", "isla de ibiza", "isla de eivissa"],
        codigos: ["07026", "07046", "07048", "07050", "07054"],
      },
      {
        nombre: "Formentera",
        provincia: "07",
        alias: ["isla de formentera"],
        codigos: ["07024"],
      },
      {
        nombre: "Mallorca",
        provincia: "07",
        alias: ["isla de mallorca"],
        resto: true,
      },
    ],
  },
];

/** Provincias insulares: fuera de ellas no hay isla que asignar. */
export const PROVINCIAS_INSULARES = DEFINICION.map((d) => d.provincia);

const POR_CODIGO = new Map<string, Isla>();
const RESTO_POR_PROVINCIA = new Map<string, Isla>();
const ISLAS: Isla[] = [];

for (const { provincia, islas } of DEFINICION) {
  for (const isla of islas) {
    const publica: Isla = { nombre: isla.nombre, provincia, alias: isla.alias };
    ISLAS.push(publica);
    if (isla.resto) {
      RESTO_POR_PROVINCIA.set(provincia, publica);
      continue;
    }
    for (const codigo of isla.codigos ?? []) POR_CODIGO.set(codigo, publica);
  }
}

/** Todas las islas conocidas, en el orden de la tabla. */
export function islas(): readonly Isla[] {
  return ISLAS;
}

/**
 * Isla de un municipio por su código INE, o `undefined` si es peninsular (o de
 * Ceuta o Melilla, que no son islas).
 */
export function islaDeMunicipio(codigo: string): Isla | undefined {
  const c = codigo.trim();
  const explicita = POR_CODIGO.get(c);
  if (explicita) return explicita;
  return RESTO_POR_PROVINCIA.get(c.slice(0, 2));
}

const POR_NOMBRE = new Map<string, Isla>();
for (const isla of ISLAS) {
  POR_NOMBRE.set(normalize(isla.nombre), isla);
  for (const alias of isla.alias ?? []) POR_NOMBRE.set(normalize(alias), isla);
}

/** Resuelve un nombre de isla ("El Hierro", "Ibiza", "gomera"). */
export function resolverIsla(entrada: string): Isla | undefined {
  return POR_NOMBRE.get(normalize(entrada));
}
