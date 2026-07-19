// Provincias españolas por código INE.
//
// Los dos primeros dígitos del código INE de un municipio son su provincia, así
// que no hace falta llevar la provincia en `municipios.json` ni regenerar el
// dataset: se deriva de esta tabla de 52 entradas.
//
// Nombres: se usan las formas naturales de uso corriente ("A Coruña", "La
// Rioja", "Las Palmas") en lugar de las invertidas del nomenclátor del INE
// ("Coruña, A"), porque estos nombres se muestran al usuario final.

/** Código INE de provincia (2 dígitos) -> nombre. */
export const PROVINCIAS: Readonly<Record<string, string>> = {
  "01": "Álava",
  "02": "Albacete",
  "03": "Alicante",
  "04": "Almería",
  "05": "Ávila",
  "06": "Badajoz",
  "07": "Illes Balears",
  "08": "Barcelona",
  "09": "Burgos",
  "10": "Cáceres",
  "11": "Cádiz",
  "12": "Castellón",
  "13": "Ciudad Real",
  "14": "Córdoba",
  "15": "A Coruña",
  "16": "Cuenca",
  "17": "Girona",
  "18": "Granada",
  "19": "Guadalajara",
  "20": "Gipuzkoa",
  "21": "Huelva",
  "22": "Huesca",
  "23": "Jaén",
  "24": "León",
  "25": "Lleida",
  "26": "La Rioja",
  "27": "Lugo",
  "28": "Madrid",
  "29": "Málaga",
  "30": "Murcia",
  "31": "Navarra",
  "32": "Ourense",
  "33": "Asturias",
  "34": "Palencia",
  "35": "Las Palmas",
  "36": "Pontevedra",
  "37": "Salamanca",
  "38": "Santa Cruz de Tenerife",
  "39": "Cantabria",
  "40": "Segovia",
  "41": "Sevilla",
  "42": "Soria",
  "43": "Tarragona",
  "44": "Teruel",
  "45": "Toledo",
  "46": "Valencia",
  "47": "Valladolid",
  "48": "Bizkaia",
  "49": "Zamora",
  "50": "Zaragoza",
  "51": "Ceuta",
  "52": "Melilla",
};

/**
 * Provincia de un código INE de municipio (5 dígitos) o de provincia (2).
 * Devuelve `undefined` si el prefijo no corresponde a ninguna provincia.
 */
export function provinciaPorCodigo(codigo: string): string | undefined {
  return PROVINCIAS[codigo.trim().slice(0, 2)];
}

/** Código de provincia (2 dígitos) de un código INE de municipio. */
export function codigoProvincia(codigoMunicipio: string): string {
  return codigoMunicipio.trim().slice(0, 2);
}

/**
 * Compara dos nombres de provincia tolerando las variantes de AEMET.
 *
 * AEMET no usa el nomenclátor del INE y ni siquiera es consistente consigo
 * misma: su inventario de estaciones trae a la vez "SANTA CRUZ DE TENERIFE" y
 * "STA. CRUZ DE TENERIFE", y "BALEARES" junto a "ILLES BALEARS". Comparando las
 * cadenas tal cual, una estación DENTRO del municipio se declaraba "en otra
 * provincia" y disparaba la advertencia de observacion_municipio, que existe
 * justo para los casos en que el dato NO representa al municipio. Un aviso que
 * salta cuando no toca enseña a ignorarlo.
 *
 * De las 54 grafías del inventario, solo tres no casaban por acentos y
 * mayúsculas: las tres están en `SINONIMOS`.
 */
const SINONIMOS: Readonly<Record<string, string>> = {
  "STA CRUZ DE TENERIFE": "SANTA CRUZ DE TENERIFE",
  BALEARES: "ILLES BALEARS",
  "ISLAS BALEARES": "ILLES BALEARS",
  "ARABA ALAVA": "ALAVA",
  ARABA: "ALAVA",
};

function normalizarProvincia(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return SINONIMOS[base] ?? base;
}

export function mismaProvincia(a: string, b: string): boolean {
  return normalizarProvincia(a) === normalizarProvincia(b);
}
