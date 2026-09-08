import type { Municipio } from "./types.js";
import { provinciaPorCodigo } from "./provincias.js";
import { islaDeMunicipio, resolverIsla, type Isla } from "./islas.js";
import { normalize } from "./texto.js";
import municipiosData from "../data/municipios.json" with { type: "json" };

export { normalize };

/** Forma cruda del dataset: solo código y nombre del nomenclátor del INE. */
interface MunicipioCrudo {
  codigo: string;
  nombre: string;
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

/** Añade provincia, nombre natural e isla, todos derivables del dataset crudo. */
function enriquecer(m: MunicipioCrudo): Municipio {
  return {
    codigo: m.codigo,
    nombre: m.nombre,
    nombreNatural: nombreNatural(m.nombre),
    // Todos los códigos del dataset tienen provincia conocida (comprobado en
    // test); el fallback evita que un código futuro rompa la carga del módulo.
    provincia: provinciaPorCodigo(m.codigo) ?? "—",
    isla: islaDeMunicipio(m.codigo)?.nombre,
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

  for (const grupo of [exacta, exactaSinArticulo, prefijo, contiene]) grupo.sort(porNombre);

  // Si lo buscado es una isla, sus municipios son lo más relevante que hay,
  // aunque su nombre no contenga el de la isla: "El Hierro" no aparece en
  // "Frontera" ni en "Valverde", y sin esto la búsqueda los perdía.
  const isla = resolverIsla(nombre);
  const deIsla = isla ? municipiosDeIsla(isla) : [];

  const vistos = new Set<string>();
  const salida: Municipio[] = [];
  for (const m of [...exacta, ...deIsla, ...exactaSinArticulo, ...prefijo, ...contiene]) {
    if (vistos.has(m.codigo)) continue;
    vistos.add(m.codigo);
    salida.push(m);
    if (salida.length >= limit) break;
  }
  return salida;
}

const porNombre = (a: Municipio, b: Municipio) =>
  a.nombreNatural.localeCompare(b.nombreNatural, "es");

/** Municipios de una provincia por su código de 2 dígitos. */
export function municipiosDeProvincia(codigoProvincia: string): Municipio[] {
  const p = codigoProvincia.trim().slice(0, 2);
  return MUNICIPIOS.filter((m) => m.codigo.startsWith(p));
}

/** Municipios de una isla, en orden alfabético. */
export function municipiosDeIsla(isla: Isla): Municipio[] {
  return MUNICIPIOS.filter((m) => m.isla === isla.nombre).sort(porNombre);
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

  // Una isla no es un municipio, pero es lo que escribe la gente ("El Hierro",
  // "Menorca"). Sin esta rama, la búsqueda por subcadena devolvía un menú
  // engañoso: para "El Hierro" salía "Cueva del Hierro" (Cuenca) y faltaban dos
  // de los tres municipios de la isla.
  const isla = resolverIsla(raw);
  if (isla) {
    const deIsla = municipiosDeIsla(isla);
    if (deIsla.length === 1) return deIsla[0]!;
    if (deIsla.length > 1) throw esUnaIsla(raw, isla, deIsla);
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

/** Etiqueta de un municipio para listados y mensajes: nombre, provincia y código. */
export function etiquetaMunicipio(m: Municipio): string {
  const donde = m.isla ? `${m.provincia}, ${m.isla}` : m.provincia;
  return `${m.nombreNatural} (${donde}) — código INE ${m.codigo}`;
}

/**
 * Error para un nombre de isla: dice que lo es y enumera sus municipios, que es
 * la información que hace falta para volver a llamar con sentido.
 */
function esUnaIsla(entrada: string, isla: Isla, municipios: Municipio[]): Error {
  const MAX = 12;
  const lista = municipios
    .slice(0, MAX)
    .map((m) => `  - ${etiquetaMunicipio(m)}`)
    .join("\n");
  const resto =
    municipios.length > MAX
      ? `\n  … y ${municipios.length - MAX} municipios más (usa buscar_municipio para verlos).`
      : "";
  return new Error(
    `"${entrada}" es una ISLA, no un municipio, y AEMET publica sus datos por ` +
      `municipio. ${isla.nombre} tiene ${municipios.length} municipios:\n${lista}${resto}\n` +
      `Vuelve a llamar con el código INE de uno. Para cubrir la isla entera hacen ` +
      `falta varias llamadas: elige los que representen las zonas que interesen.`,
  );
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
