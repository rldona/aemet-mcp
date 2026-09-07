import type { Municipio } from "./types.js";
import { provinciaPorCodigo } from "./provincias.js";
import municipiosData from "../data/municipios.json" with { type: "json" };

/** Forma cruda del dataset: solo código y nombre del nomenclátor del INE. */
interface MunicipioCrudo {
  codigo: string;
  nombre: string;
}

/** Normaliza para match tolerante: minúsculas, sin acentos, sin puntuación. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // quita diacríticos combinantes (acentos, tildes)
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Artículos que el INE pospone tras coma. Extraídos del propio dataset, no de
 * una lista teórica: castellano, catalán/valenciano, gallego y balear.
 *
 * La lista es cerrada a propósito. Hay nombres con coma que NO llevan artículo
 * ("Castell-Platja d'Aro, Platja d'Aro i s'Agaró"), y tratarlos como tal
 * generaría variantes absurdas.
 */
const ARTICULOS = new Set([
  "el", "la", "los", "las", // castellano
  "l", "els", "les", // catalán/valenciano (l' pierde el apóstrofo al normalizar)
  "es", "sa", "ses", // balear
  "o", "a", "os", "as", // gallego
]);

/** Separa "Campello, el" en base y artículo, si lo que hay tras la coma lo es. */
function partirArticulo(segmento: string): { base: string; articulo: string } | null {
  const m = /^(.+),\s*([^,]+)$/.exec(segmento);
  if (!m) return null;
  const articulo = m[2]!.trim();
  if (!ARTICULOS.has(normalize(articulo))) return null;
  return { base: m[1]!.trim(), articulo };
}

/** "Campello, el" -> "el Campello"; "Atzúbia, l'" -> "l'Atzúbia". */
function naturalizar(segmento: string): string {
  const p = partirArticulo(segmento);
  if (!p) return segmento;
  return p.articulo.endsWith("'")
    ? `${p.articulo}${p.base}`
    : `${p.articulo} ${p.base}`;
}

/**
 * Nombre en forma natural, para mostrar al usuario.
 *
 * Se aplica a cada alternativa lingüística por separado, así que
 * "Camp de Mirra, el/Campo de Mirra" queda "el Camp de Mirra/Campo de Mirra".
 */
export function nombreNatural(nombre: string): string {
  return nombre
    .split("/")
    .map((seg) => naturalizar(seg.trim()))
    .join("/");
}

/**
 * Formas por las que un municipio debería encontrarse, en dos niveles.
 *
 * El INE guarda "Campello, el" y "Coruña, A", así que buscar "El Campello" o
 * "A Coruña" —como los escribe cualquiera— no encontraba nada.
 *
 * La separación en dos niveles no es cosmética. La base sin artículo NO puede
 * competir como coincidencia exacta: "La Granada" (Barcelona) tiene base
 * "Granada", y tratarla como exacta volvía ambiguo el nombre "Granada", que
 * antes resolvía a Granada capital. Las secundarias solo entran si ninguna
 * principal coincide.
 */
export function variantesNombre(nombre: string): {
  principales: string[];
  secundarias: string[];
} {
  const principales = new Set<string>();
  const secundarias = new Set<string>();

  for (const seg of nombre.split("/")) {
    const s = seg.trim();
    if (!s) continue;
    principales.add(s); // forma del INE: "Campello, el"
    const p = partirArticulo(s);
    if (!p) continue;
    principales.add(naturalizar(s)); // forma natural: "el Campello"
    secundarias.add(p.base); // base sin artículo: "Campello"
  }

  return { principales: [...principales], secundarias: [...secundarias] };
}

/** Añade provincia y nombre natural, ambos derivables del dataset crudo. */
function enriquecer(m: MunicipioCrudo): Municipio {
  return {
    codigo: m.codigo,
    nombre: m.nombre,
    nombreNatural: nombreNatural(m.nombre),
    // Todos los códigos del dataset tienen provincia conocida (comprobado en
    // test); el fallback evita que un código futuro rompa la carga del módulo.
    provincia: provinciaPorCodigo(m.codigo) ?? "—",
  };
}

const MUNICIPIOS: Municipio[] = (municipiosData as MunicipioCrudo[]).map(enriquecer);

// Índice normalizado precomputado (una sola pasada al cargar el módulo).
interface Entrada {
  principales: string[];
  secundarias: string[];
  /** Principales + secundarias, para los match por prefijo y por contenido. */
  todas: string[];
  m: Municipio;
}

const INDEX: Entrada[] = MUNICIPIOS.map((m) => {
  const v = variantesNombre(m.nombre);
  const principales = v.principales.map(normalize);
  const secundarias = v.secundarias.map(normalize);
  return { principales, secundarias, todas: [...principales, ...secundarias], m };
});

const BY_CODIGO = new Map<string, Municipio>(
  MUNICIPIOS.map((m) => [m.codigo, m]),
);

/** ¿Es un código INE de 5 dígitos? */
export function esCodigoINE(s: string): boolean {
  return /^\d{5}$/.test(s.trim());
}

export function municipioPorCodigo(codigo: string): Municipio | undefined {
  return BY_CODIGO.get(codigo.trim());
}

/**
 * Busca municipios por nombre. Devuelve coincidencias ordenadas por relevancia:
 * exacta > empieza-por > contiene. `limit` acota el número de resultados.
 *
 * El match va contra todas las variantes del nombre (ver `variantesNombre`), así
 * que "El Campello", "Campello, el" y "Campello" encuentran lo mismo.
 *
 * AEMET distingue nombres duplicados por provincia (p. ej. varios "Villanueva");
 * por eso se devuelven varias coincidencias y no una sola.
 */
export function buscarMunicipios(nombre: string, limit = 15): Municipio[] {
  const q = normalize(nombre);
  if (!q) return [];

  const exacta: Municipio[] = [];
  const exactaSinArticulo: Municipio[] = [];
  const prefijo: Municipio[] = [];
  const contiene: Municipio[] = [];

  for (const e of INDEX) {
    if (e.principales.some((v) => v === q)) exacta.push(e.m);
    else if (e.secundarias.some((v) => v === q)) exactaSinArticulo.push(e.m);
    else if (e.todas.some((v) => v.startsWith(q))) prefijo.push(e.m);
    else if (e.todas.some((v) => v.includes(q))) contiene.push(e.m);
  }

  const porNombre = (a: Municipio, b: Municipio) =>
    a.nombreNatural.localeCompare(b.nombreNatural, "es");
  for (const grupo of [exacta, exactaSinArticulo, prefijo, contiene]) grupo.sort(porNombre);

  return [...exacta, ...exactaSinArticulo, ...prefijo, ...contiene].slice(0, limit);
}

/**
 * Resuelve una entrada de usuario (código INE o nombre) a un municipio único.
 *
 * - Si es un código de 5 dígitos, lo busca directo.
 * - Si es un nombre con una única coincidencia clara (exacta o única), la usa.
 * - Si es ambiguo, lanza un error con las opciones para que el LLM desambigüe.
 */
export function resolverMunicipio(entrada: string): Municipio {
  const raw = entrada.trim();

  if (esCodigoINE(raw)) {
    const m = municipioPorCodigo(raw);
    if (!m) {
      throw new Error(
        `No existe ningún municipio con código INE ${raw}. Usa buscar_municipio para encontrar el código correcto.`,
      );
    }
    return m;
  }

  const q = normalize(raw);

  // Primero las formas principales (INE y natural). Solo si ninguna coincide se
  // consideran las bases sin artículo, para que "Granada" no compita con la
  // base de "La Granada".
  const exactas = INDEX.filter((e) => e.principales.some((v) => v === q)).map((e) => e.m);
  if (exactas.length === 1) return exactas[0]!;
  if (exactas.length > 1) throw ambiguo(raw, exactas);

  const sinArticulo = INDEX.filter((e) => e.secundarias.some((v) => v === q)).map((e) => e.m);
  if (sinArticulo.length === 1) return sinArticulo[0]!;
  if (sinArticulo.length > 1) throw ambiguo(raw, sinArticulo);

  const candidatos = buscarMunicipios(raw, 10);
  if (candidatos.length === 0) {
    throw new Error(
      `No se encontró ningún municipio que coincida con "${raw}". Prueba con buscar_municipio.`,
    );
  }
  if (candidatos.length === 1) return candidatos[0]!;

  throw ambiguo(raw, candidatos);
}

/** Etiqueta de un municipio para listados y mensajes: nombre, provincia y código. */
export function etiquetaMunicipio(m: Municipio): string {
  return `${m.nombreNatural} (${m.provincia}) — código INE ${m.codigo}`;
}

function ambiguo(entrada: string, opciones: Municipio[]): Error {
  const lista = opciones
    .slice(0, 10)
    .map((m) => `  - ${etiquetaMunicipio(m)}`)
    .join("\n");
  return new Error(
    `"${entrada}" es ambiguo. Municipios que coinciden:\n${lista}\n` +
      `Vuelve a llamar indicando el código INE de 5 dígitos del municipio correcto.`,
  );
}

export function totalMunicipios(): number {
  return MUNICIPIOS.length;
}
