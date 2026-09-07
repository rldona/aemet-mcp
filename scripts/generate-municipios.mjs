// Genera src/data/municipios.json a partir del diccionario oficial de municipios
// del INE (fuente autoritativa de los códigos INE de 5 dígitos que usa AEMET).
//
// El código INE de municipio = CPRO (2 dígitos) + CMUN (3 dígitos).
//
// Uso:
//   node scripts/generate-municipios.mjs [ruta-al-xlsx]
//
// Si no se pasa ruta, descarga el diccionario más reciente que publique el INE
// (o el de la variable de entorno INE_URL, si se fija).
// El fichero es un .xlsx (zip OOXML); lo parseamos sin dependencias con `unzip`.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// El INE publica un diccionario por año en la misma ruta, cambiando solo las dos
// últimas cifras del año. Se prueba desde el año en curso hacia atrás y se usa el
// primero que exista, en lugar de dejar una URL fija que se queda vieja en
// silencio: el dataset llegó a estar dos años desfasado justamente por eso.
const INE_BASE = "https://www.ine.es/daco/daco42/codmun/diccionario";
const INE_ANIOS_ATRAS = 4;

/** URL del diccionario más reciente disponible, o la de `INE_URL` si se fija. */
async function resolverUrlINE() {
  if (process.env.INE_URL) return process.env.INE_URL;

  const anioActual = new Date().getFullYear();
  const probados = [];
  for (let i = 0; i <= INE_ANIOS_ATRAS; i++) {
    const anio = anioActual - i;
    const url = `${INE_BASE}${String(anio).slice(-2)}.xlsx`;
    probados.push(url);
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) {
        console.error(`Diccionario del INE encontrado: ${url}`);
        return url;
      }
    } catch {
      // Sin red o host caído: se prueba el siguiente año.
    }
  }
  throw new Error(
    `No se encontró ningún diccionario del INE. Probados:\n  ${probados.join("\n  ")}\n` +
      `Fija la URL con la variable de entorno INE_URL si la ruta ha cambiado.`,
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "data", "municipios.json");

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// Parsea sharedStrings.xml -> array de strings indexado.
function parseSharedStrings(xml) {
  const strings = [];
  // Cada <si> puede tener uno o varios <t>. Concatenamos su contenido.
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    let text = "";
    for (const m of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
      text += m[1];
    }
    strings.push(decodeXmlEntities(text));
  }
  return strings;
}

// Parsea una fila -> mapa columna(letra) -> valor (string ya resuelto).
function parseRow(rowXml, shared) {
  const cells = {};
  for (const c of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g)) {
    const col = c[1];
    const attrs = c[2];
    const rawV = c[3];
    if (rawV === undefined) continue;
    const isShared = /t="s"/.test(attrs);
    cells[col] = isShared ? shared[Number(rawV)] ?? "" : decodeXmlEntities(rawV);
  }
  return cells;
}

async function main() {
  const argPath = process.argv[2];
  let xlsxPath = argPath;

  if (!xlsxPath) {
    const urlINE = await resolverUrlINE();
    xlsxPath = join(mkdtempSync(join(tmpdir(), "ine-")), "diccionario.xlsx");
    console.error(`Descargando diccionario INE desde ${urlINE} ...`);
    execFileSync("curl", ["-sSL", "--fail", "-o", xlsxPath, urlINE], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  if (!existsSync(xlsxPath)) {
    throw new Error(`No existe el xlsx: ${xlsxPath}`);
  }

  const workDir = mkdtempSync(join(tmpdir(), "ine-x-"));
  execFileSync("unzip", ["-oq", xlsxPath, "-d", workDir]);

  const shared = parseSharedStrings(
    readFileSync(join(workDir, "xl", "sharedStrings.xml"), "utf8"),
  );
  const sheet = readFileSync(
    join(workDir, "xl", "worksheets", "sheet1.xml"),
    "utf8",
  );

  const rows = sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? [];
  const municipios = [];
  let headerCols = null;

  for (const rowXml of rows) {
    const cells = parseRow(rowXml, shared);
    const values = Object.values(cells);
    // Fila de cabecera: contiene los rótulos CPRO / CMUN / NOMBRE.
    if (!headerCols) {
      if (values.some((v) => /^CPRO$/i.test(v)) && values.some((v) => /^CMUN$/i.test(v))) {
        headerCols = {};
        for (const [col, val] of Object.entries(cells)) {
          const key = val.trim().toUpperCase();
          if (["CPRO", "CMUN", "NOMBRE"].includes(key)) headerCols[key] = col;
        }
      }
      continue;
    }
    const cpro = cells[headerCols.CPRO];
    const cmun = cells[headerCols.CMUN];
    const nombre = cells[headerCols.NOMBRE];
    if (!cpro || !cmun || !nombre) continue;
    const codigo = String(cpro).padStart(2, "0") + String(cmun).padStart(3, "0");
    if (!/^\d{5}$/.test(codigo)) continue;
    municipios.push({ codigo, nombre: nombre.trim() });
  }

  if (municipios.length < 8000) {
    throw new Error(
      `Solo se parsearon ${municipios.length} municipios; se esperaban >8000. ¿Cambió el formato del xlsx?`,
    );
  }

  municipios.sort((a, b) => a.codigo.localeCompare(b.codigo));
  writeFileSync(OUT, JSON.stringify(municipios) + "\n");
  console.error(`OK: ${municipios.length} municipios -> ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
