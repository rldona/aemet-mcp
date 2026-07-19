import type { Municipio } from "./types.js";
import municipiosData from "../data/municipios.json" with { type: "json" };

const MUNICIPIOS = municipiosData as Municipio[];

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

// Índice normalizado precomputado (una sola pasada al cargar el módulo).
const INDEX: Array<{ norm: string; m: Municipio }> = MUNICIPIOS.map((m) => ({
  norm: normalize(m.nombre),
  m,
}));

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
 * AEMET distingue nombres duplicados por provincia (p. ej. varios "Villanueva");
 * por eso se devuelven varias coincidencias y no una sola.
 */
export function buscarMunicipios(nombre: string, limit = 15): Municipio[] {
  const q = normalize(nombre);
  if (!q) return [];

  const exact: Municipio[] = [];
  const prefix: Municipio[] = [];
  const contains: Municipio[] = [];

  for (const { norm, m } of INDEX) {
    if (norm === q) exact.push(m);
    else if (norm.startsWith(q)) prefix.push(m);
    else if (norm.includes(q)) contains.push(m);
  }

  const byName = (a: Municipio, b: Municipio) => a.nombre.localeCompare(b.nombre, "es");
  exact.sort(byName);
  prefix.sort(byName);
  contains.sort(byName);

  return [...exact, ...prefix, ...contains].slice(0, limit);
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
  const exactas = INDEX.filter((e) => e.norm === q).map((e) => e.m);
  if (exactas.length === 1) return exactas[0]!;

  if (exactas.length > 1) {
    throw ambiguo(raw, exactas);
  }

  const candidatos = buscarMunicipios(raw, 10);
  if (candidatos.length === 0) {
    throw new Error(
      `No se encontró ningún municipio que coincida con "${raw}". Prueba con buscar_municipio.`,
    );
  }
  if (candidatos.length === 1) return candidatos[0]!;

  throw ambiguo(raw, candidatos);
}

function ambiguo(entrada: string, opciones: Municipio[]): Error {
  const lista = opciones
    .slice(0, 10)
    .map((m) => `  - ${m.nombre} (${m.codigo})`)
    .join("\n");
  return new Error(
    `"${entrada}" es ambiguo. Municipios que coinciden:\n${lista}\n` +
      `Vuelve a llamar indicando el código INE de 5 dígitos del municipio correcto.`,
  );
}

export function totalMunicipios(): number {
  return MUNICIPIOS.length;
}
