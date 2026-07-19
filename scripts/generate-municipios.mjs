// Genera src/data/municipios.json a partir del diccionario oficial de municipios
// del INE (fuente autoritativa de los códigos INE de 5 dígitos que usa AEMET).
//
// El código INE de municipio = CPRO (2 dígitos) + CMUN (3 dígitos).
//
// Uso:
//   node scripts/generate-municipios.mjs [ruta-al-xlsx]
//
// Si no se pasa ruta, descarga el diccionario del año configurado en INE_URL.
// El fichero es un .xlsx (zip OOXML); lo parseamos sin dependencias con `unzip`.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const INE_URL =
  "https://www.ine.es/daco/daco42/codmun/diccionario24.xlsx";

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

function main() {
  const argPath = process.argv[2];
  let xlsxPath = argPath;

  if (!xlsxPath) {
    xlsxPath = join(mkdtempSync(join(tmpdir(), "ine-")), "diccionario.xlsx");
    console.error(`Descargando diccionario INE desde ${INE_URL} ...`);
    execFileSync("curl", ["-sSL", "--fail", "-o", xlsxPath, INE_URL], {
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

main();
