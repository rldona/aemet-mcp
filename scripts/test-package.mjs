#!/usr/bin/env node
// Valida el TARBALL PUBLICABLE, no el árbol de trabajo.
//
// Empaqueta con `npm pack`, lo instala en un proyecto limpio fuera del repo y
// comprueba lo que solo se rompe al publicar: resolución de `exports` en ESM y
// en CommonJS, tipos, permisos del binario, arranque del servidor MCP y que no
// se cuele en el paquete nada que no toque.
//
// Se ejecuta en CI en toda la matriz de Node soportada (`npm run test:pack`),
// que es lo que le da valor: la resolución de módulos cambia entre versiones.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));

/** Exportaciones que el paquete promete: si desaparecen, es un cambio incompatible. */
const EXPORTS_ESPERADAS = [
  "AemetClient",
  "AemetError",
  "TtlCache",
  "TTL",
  "AEMET_HOSTS",
  "validarUrlDatos",
  "buscarMunicipios",
  "resolverMunicipio",
  "resolverArea",
  "obtenerAvisos",
  "extraerAvisos",
  "untar",
  "resolverEstacion",
  "formatDiaria",
  "formatAvisos",
];

/** Rutas que NO deben viajar en el tarball. */
const PROHIBIDAS = [/(^|\/)\.env/, /(^|\/)\.npmrc$/, /^package\/src\//, /^package\/test\//];

const HERRAMIENTAS = [
  "avisos",
  "buscar_municipio",
  "observacion_estacion",
  "prediccion_diaria",
  "prediccion_horaria",
];

let fallos = 0;
let tmp;

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });
  if (res.error) throw res.error;
  return res;
}

function comprueba(nombre, fn) {
  try {
    const detalle = fn();
    console.log(`  ✓ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  } catch (err) {
    fallos++;
    console.error(`  ✗ ${nombre}\n      ${err.message.split("\n").join("\n      ")}`);
  }
}

function afirma(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

// ---------------------------------------------------------------------------

console.log(`\nValidando el paquete ${PKG.name}@${PKG.version} en Node ${process.version}\n`);

try {
  console.log("· Construyendo y empaquetando");
  const build = run("npm", ["run", "build"], { cwd: RAIZ });
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
  }

  tmp = mkdtempSync(join(tmpdir(), "aemet-pack-"));
  const consumidor = join(tmp, "consumidor");

  const pack = run("npm", ["pack", "--json", "--pack-destination", tmp], { cwd: RAIZ });
  if (pack.status !== 0) {
    console.error(pack.stderr || pack.stdout);
    process.exit(1);
  }
  const tarball = join(tmp, JSON.parse(pack.stdout)[0].filename);

  // -- contenido del tarball --------------------------------------------------
  console.log("\n· Contenido del tarball");
  const listado = run("tar", ["-tzf", tarball]).stdout.split("\n").filter(Boolean);

  comprueba("incluye el bin, la librería y los tipos", () => {
    for (const f of ["package/dist/index.js", "package/dist/lib.js", "package/dist/lib.d.ts"]) {
      afirma(listado.includes(f), `falta ${f}`);
    }
    return `${listado.length} ficheros`;
  });

  comprueba("incluye README y LICENSE", () => {
    afirma(listado.includes("package/README.md"), "falta README.md");
    afirma(listado.includes("package/LICENSE"), "falta LICENSE");
  });

  comprueba("no se cuela nada que no toque", () => {
    const colados = listado.filter((f) => PROHIBIDAS.some((re) => re.test(f)));
    afirma(colados.length === 0, `ficheros indebidos: ${colados.join(", ")}`);
  });

  // -- instalación en un proyecto limpio --------------------------------------
  console.log("\n· Instalación en un proyecto limpio");
  // Fuera del repo, para que la resolución no caiga por accidente en su
  // node_modules ni herede su package.json.
  mkdirSync(consumidor, { recursive: true });
  writeFileSync(
    join(consumidor, "package.json"),
    JSON.stringify({ name: "consumidor", version: "1.0.0", private: true }, null, 2),
  );

  const install = run("npm", ["install", tarball, "--no-audit", "--no-fund"], { cwd: consumidor });
  if (install.status !== 0) {
    console.error(install.stderr || install.stdout);
    process.exit(1);
  }
  console.log("  ✓ instalado desde el tarball");

  // -- resolución ESM ---------------------------------------------------------
  console.log("\n· Resolución de módulos");
  comprueba("import desde ESM", () => {
    const script = `
      const m = await import(${JSON.stringify(PKG.name)});
      const faltan = ${JSON.stringify(EXPORTS_ESPERADAS)}.filter((k) => !(k in m));
      if (faltan.length) { console.error("faltan exports: " + faltan.join(", ")); process.exit(1); }
      console.log(Object.keys(m).length);
    `;
    const res = run(process.execPath, ["--input-type=module", "-e", script], { cwd: consumidor });
    afirma(res.status === 0, (res.stderr || res.stdout).trim());
    return `${res.stdout.trim()} exports`;
  });

  comprueba("require desde CommonJS (require(esm), Node >= 20.19)", () => {
    const script = `
      const m = require(${JSON.stringify(PKG.name)});
      const faltan = ${JSON.stringify(EXPORTS_ESPERADAS)}.filter((k) => !(k in m));
      if (faltan.length) { console.error("faltan exports: " + faltan.join(", ")); process.exit(1); }
    `;
    const res = run(process.execPath, ["--input-type=commonjs", "-e", script], { cwd: consumidor });
    afirma(res.status === 0, (res.stderr || res.stdout).trim());
  });

  // -- tipos ------------------------------------------------------------------
  comprueba("los tipos resuelven bajo moduleResolution NodeNext", () => {
    writeFileSync(
      join(consumidor, "consumidor.ts"),
      `import { AemetClient, type Municipio, resolverMunicipio } from "${PKG.name}";\n` +
        `const c: AemetClient = new AemetClient({ apiKey: "x", timeoutMs: 1000 });\n` +
        `const m: Municipio | undefined = resolverMunicipio("Madrid");\n` +
        `export { c, m };\n`,
    );
    writeFileSync(
      join(consumidor, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2022",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: [],
          },
          files: ["consumidor.ts"],
        },
        null,
        2,
      ),
    );
    // Se usa el tsc del repo: instalarlo en el consumidor solo alargaría el CI.
    const tsc = join(RAIZ, "node_modules", "typescript", "bin", "tsc");
    const res = run(process.execPath, [tsc, "--project", join(consumidor, "tsconfig.json")]);
    afirma(res.status === 0, (res.stdout || res.stderr).trim());
  });

  // -- binario ----------------------------------------------------------------
  console.log("\n· Binario y arranque MCP");
  const binReal = join(consumidor, "node_modules", PKG.name, "dist", "index.js");

  comprueba("el binario tiene permiso de ejecución", () => {
    const modo = statSync(binReal).mode;
    afirma((modo & 0o111) !== 0, `modo ${(modo & 0o777).toString(8)} sin bit de ejecución`);
    return `modo ${(modo & 0o777).toString(8)}`;
  });

  comprueba("el binario lleva shebang", () => {
    const primera = readFileSync(binReal, "utf8").split("\n", 1)[0];
    afirma(primera.startsWith("#!"), `primera línea: ${primera.slice(0, 40)}`);
  });

  comprueba("handshake MCP contra el paquete instalado", () => {
    // Se ejecuta dentro del consumidor para que el SDK se resuelva desde SU
    // node_modules, no desde el del repo.
    const check = join(consumidor, "check-mcp.mjs");
    writeFileSync(
      check,
      `import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [${JSON.stringify(binReal)}],
  env: { PATH: process.env.PATH ?? "" },
});
const client = new Client({ name: "pack-test", version: "0" });
await client.connect(transport);

const info = client.getServerVersion();
if (info?.name !== "aemet-mcp") throw new Error("nombre inesperado: " + info?.name);
if (info?.version !== ${JSON.stringify(PKG.version)}) {
  throw new Error("versión anunciada " + info?.version + " != " + ${JSON.stringify(PKG.version)});
}

const { tools } = await client.listTools();
const nombres = tools.map((t) => t.name).sort();
const esperadas = ${JSON.stringify(HERRAMIENTAS)};
if (JSON.stringify(nombres) !== JSON.stringify(esperadas)) {
  throw new Error("tools: " + nombres.join(",") + " != " + esperadas.join(","));
}

const res = await client.callTool({ name: "buscar_municipio", arguments: { nombre: "Madrid" } });
if (res.isError) throw new Error("buscar_municipio devolvió error");

await client.close();
console.log(info.version + " · " + nombres.length + " tools");
`,
    );
    const res = run(process.execPath, [check], { cwd: consumidor });
    afirma(res.status === 0, (res.stderr || res.stdout).trim());
    return res.stdout.trim();
  });
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

if (fallos > 0) {
  console.error(`\n${fallos} comprobación(es) fallaron sobre el paquete empaquetado.\n`);
  process.exit(1);
}
console.log("\nEl paquete empaquetado es consumible.\n");
