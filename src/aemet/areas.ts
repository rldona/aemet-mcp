import { normalize } from "./municipios.js";

// Códigos de área de AEMET para avisos CAP por comunidad autónoma.
// VERIFICADOS empíricamente contra la API inspeccionando las zonas (areaDesc) que
// devuelve cada código: van en orden alfabético de comunidad y NO coinciden con
// el orden "intuitivo" (p. ej. 65 = Canarias, no Cantabria; 78 = Ceuta).
export const AREAS: Array<{ codigo: string; nombre: string; alias?: string[] }> = [
  { codigo: "61", nombre: "Andalucía" },
  { codigo: "62", nombre: "Aragón" },
  { codigo: "63", nombre: "Asturias", alias: ["principado de asturias"] },
  { codigo: "64", nombre: "Islas Baleares", alias: ["baleares", "illes balears"] },
  { codigo: "65", nombre: "Canarias", alias: ["islas canarias"] },
  { codigo: "66", nombre: "Cantabria" },
  { codigo: "67", nombre: "Castilla y León", alias: ["castilla leon"] },
  { codigo: "68", nombre: "Castilla-La Mancha", alias: ["castilla la mancha"] },
  { codigo: "69", nombre: "Cataluña", alias: ["catalunya"] },
  { codigo: "70", nombre: "Extremadura" },
  { codigo: "71", nombre: "Galicia" },
  { codigo: "72", nombre: "Comunidad de Madrid", alias: ["madrid"] },
  { codigo: "73", nombre: "Región de Murcia", alias: ["murcia"] },
  { codigo: "74", nombre: "Navarra", alias: ["comunidad foral de navarra", "nafarroa"] },
  { codigo: "75", nombre: "País Vasco", alias: ["euskadi", "pais vasco"] },
  { codigo: "76", nombre: "La Rioja", alias: ["rioja"] },
  { codigo: "77", nombre: "Comunidad Valenciana", alias: ["valencia", "comunitat valenciana", "c valenciana"] },
  { codigo: "78", nombre: "Ceuta" },
  { codigo: "79", nombre: "Melilla" },
];

const BY_CODIGO = new Map(AREAS.map((a) => [a.codigo, a]));

/** Resuelve la entrada (código o nombre de CCAA) a un área de avisos. */
export function resolverArea(entrada: string): (typeof AREAS)[number] {
  const raw = entrada.trim();
  if (/^\d{2}$/.test(raw)) {
    const a = BY_CODIGO.get(raw);
    if (a) return a;
    throw new Error(`Código de área ${raw} no válido. ${listaAreas()}`);
  }

  const q = normalize(raw);
  const match = AREAS.find(
    (a) => normalize(a.nombre) === q || (a.alias ?? []).some((al) => normalize(al) === q),
  );
  if (match) return match;

  // Coincidencia parcial (p. ej. "castilla" es ambiguo -> pedir precisión).
  const parciales = AREAS.filter(
    (a) => normalize(a.nombre).includes(q) || (a.alias ?? []).some((al) => normalize(al).includes(q)),
  );
  if (parciales.length === 1) return parciales[0]!;
  if (parciales.length > 1) {
    throw new Error(
      `"${raw}" coincide con varias comunidades: ${parciales.map((a) => a.nombre).join(", ")}. Sé más específico.`,
    );
  }
  throw new Error(`No se reconoce la comunidad autónoma "${raw}". ${listaAreas()}`);
}

function listaAreas(): string {
  return `Comunidades válidas: ${AREAS.map((a) => a.nombre).join(", ")}.`;
}

/** Provincia INE (2 primeros dígitos del código de municipio) -> área CAP. */
const PROVINCIA_A_AREA: Record<string, string> = {
  "04": "61", "11": "61", "14": "61", "18": "61", "21": "61", "23": "61", "29": "61", "41": "61", // Andalucía
  "22": "62", "44": "62", "50": "62", // Aragón
  "33": "63", // Asturias
  "07": "64", // Islas Baleares
  "35": "65", "38": "65", // Canarias
  "39": "66", // Cantabria
  "05": "67", "09": "67", "24": "67", "34": "67", "37": "67", "40": "67", "42": "67", "47": "67", "49": "67", // Castilla y León
  "02": "68", "13": "68", "16": "68", "19": "68", "45": "68", // Castilla-La Mancha
  "08": "69", "17": "69", "25": "69", "43": "69", // Cataluña
  "06": "70", "10": "70", // Extremadura
  "15": "71", "27": "71", "32": "71", "36": "71", // Galicia
  "28": "72", // Comunidad de Madrid
  "30": "73", // Región de Murcia
  "31": "74", // Navarra
  "01": "75", "20": "75", "48": "75", // País Vasco
  "26": "76", // La Rioja
  "03": "77", "12": "77", "46": "77", // Comunidad Valenciana
  "51": "78", // Ceuta
  "52": "79", // Melilla
};

/** Área de avisos CAP para un código INE de municipio (5 dígitos). */
export function areaParaMunicipio(
  codigoMunicipio: string,
): (typeof AREAS)[number] | undefined {
  const codigo = PROVINCIA_A_AREA[codigoMunicipio.slice(0, 2)];
  return codigo ? AREAS.find((a) => a.codigo === codigo) : undefined;
}
