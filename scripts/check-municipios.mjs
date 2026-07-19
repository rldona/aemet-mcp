#!/usr/bin/env node
// Valida el dataset de municipios y, si se le pasa el anterior, resume qué ha
// cambiado.
//
// El INE publica un diccionario nuevo cada año, con altas, bajas y fusiones. Ese
// fichero es la fuente de los códigos que usa AEMET, así que una regeneración
// silenciosa que rompa un puñado de códigos se manifestaría mucho después, como
// "ese pueblo ya no da predicción". Este script convierte esa regeneración en un
// diff revisable.
//
// Uso:
//   node scripts/check-municipios.mjs                 # valida el dataset actual
//   node scripts/check-municipios.mjs <anterior.json> # además, compara

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const ACTUAL = join(RAIZ, "src", "data", "municipios.json");

/** Prefijos INE de provincia válidos: 01..52, sin huecos. */
const PROVINCIAS = new Set(
  Array.from({ length: 52 }, (_, i) => String(i + 1).padStart(2, "0")),
);

/**
 * Márgenes de cordura. España tiene ~8.100 municipios y el número se mueve muy
 * poco de un año a otro (unidades, por fusiones). Un salto grande significa que
 * el parseo se rompió, no que hayan desaparecido cien pueblos.
 */
const MIN_MUNICIPIOS = 8000;
const MAX_MUNICIPIOS = 8300;
const MAX_CAMBIOS_PORCENTAJE = 2;

const problemas = [];
const avisos = [];

function leer(ruta) {
  const datos = JSON.parse(readFileSync(ruta, "utf8"));
  if (!Array.isArray(datos)) throw new Error(`${ruta} no contiene un array`);
  return datos;
}

// --------------------------------------------------------------- validación

const municipios = leer(ACTUAL);

if (municipios.length < MIN_MUNICIPIOS || municipios.length > MAX_MUNICIPIOS) {
  problemas.push(
    `Cantidad fuera de rango: ${municipios.length} (se esperan entre ` +
      `${MIN_MUNICIPIOS} y ${MAX_MUNICIPIOS}). ¿Cambió el formato del xlsx del INE?`,
  );
}

const vistos = new Map();
const provinciasVistas = new Set();

for (const m of municipios) {
  if (typeof m?.codigo !== "string" || typeof m?.nombre !== "string") {
    problemas.push(`Entrada malformada: ${JSON.stringify(m).slice(0, 120)}`);
    continue;
  }
  if (!/^\d{5}$/.test(m.codigo)) {
    problemas.push(`Código no válido: "${m.codigo}" (${m.nombre})`);
    continue;
  }
  const provincia = m.codigo.slice(0, 2);
  if (!PROVINCIAS.has(provincia)) {
    problemas.push(`Provincia desconocida ${provincia} en ${m.codigo} (${m.nombre})`);
  }
  provinciasVistas.add(provincia);

  if (vistos.has(m.codigo)) {
    problemas.push(`Código duplicado ${m.codigo}: "${vistos.get(m.codigo)}" y "${m.nombre}"`);
  }
  vistos.set(m.codigo, m.nombre);

  if (m.nombre.trim() === "") problemas.push(`Nombre vacío en ${m.codigo}`);
}

// La tabla de provincias de src/aemet/provincias.ts tiene 52 entradas: si el
// dataset dejara de cubrirlas todas, algo se parseó mal.
const faltantes = [...PROVINCIAS].filter((p) => !provinciasVistas.has(p));
if (faltantes.length > 0) {
  problemas.push(`Provincias sin ningún municipio: ${faltantes.join(", ")}`);
}

// --------------------------------------------------------------- comparación

const anteriorRuta = process.argv[2];
let resumen = "";

if (anteriorRuta) {
  const anterior = leer(anteriorRuta);
  const antes = new Map(anterior.map((m) => [m.codigo, m.nombre]));
  const ahora = new Map(municipios.map((m) => [m.codigo, m.nombre]));

  const altas = [...ahora].filter(([c]) => !antes.has(c));
  const bajas = [...antes].filter(([c]) => !ahora.has(c));
  const renombrados = [...ahora].filter(
    ([c, n]) => antes.has(c) && antes.get(c) !== n,
  );

  const cambios = altas.length + bajas.length + renombrados.length;
  const porcentaje = (cambios / Math.max(1, anterior.length)) * 100;
  if (porcentaje > MAX_CAMBIOS_PORCENTAJE) {
    problemas.push(
      `Demasiados cambios: ${cambios} sobre ${anterior.length} ` +
        `(${porcentaje.toFixed(1)}%, máximo ${MAX_CAMBIOS_PORCENTAJE}%). ` +
        `Revisa a mano antes de aceptar.`,
    );
  }

  const lista = (titulo, entradas) =>
    entradas.length === 0
      ? ""
      : `\n### ${titulo} (${entradas.length})\n\n` +
        entradas
          .slice(0, 50)
          .map(([c, n]) => `- \`${c}\` ${n}`)
          .join("\n") +
        (entradas.length > 50 ? `\n- … y ${entradas.length - 50} más` : "") +
        "\n";

  resumen =
    `## Cambios en el dataset del INE\n\n` +
    `- Antes: ${anterior.length} municipios\n` +
    `- Ahora: ${municipios.length} municipios\n` +
    `- Altas: ${altas.length} · Bajas: ${bajas.length} · Renombrados: ${renombrados.length}\n` +
    lista("Altas", altas) +
    lista("Bajas", bajas) +
    lista(
      "Renombrados",
      renombrados.map(([c, n]) => [c, `${antes.get(c)} → ${n}`]),
    );

  if (cambios === 0) avisos.push("El dataset no ha cambiado respecto al anterior.");
}

// --------------------------------------------------------------- salida

console.log(`Dataset: ${municipios.length} municipios, ${provinciasVistas.size} provincias`);
for (const a of avisos) console.log(`  · ${a}`);

if (resumen) console.log(`\n${resumen}`);

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log("\nEl dataset es válido.");
