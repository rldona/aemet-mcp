import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Smoke test del servidor MCP real: arranca `dist/index.js` como proceso hijo,
 * completa el handshake por stdio y comprueba el inventario de herramientas.
 *
 * Es el único test que ejerce `src/index.ts`. Cubre las regresiones que ningún
 * test unitario ve: que el bin arranque, que el registro de tools no se rompa
 * al reordenar imports y que la versión anunciada por MCP sea la publicada.
 *
 * Necesita el build hecho: en CI, `npm run build` va antes de `npm test`.
 */

const raiz = new URL("../", import.meta.url);
const BIN = fileURLToPath(new URL("dist/index.js", raiz));
const PKG = JSON.parse(
  readFileSync(fileURLToPath(new URL("package.json", raiz)), "utf8"),
) as { version: string; name: string };

const HERRAMIENTAS = [
  "avisos",
  "avisos_municipio",
  "buscar_estacion",
  "buscar_municipio",
  "observacion_estacion",
  "observacion_municipio",
  "prediccion_diaria",
  "prediccion_horaria",
];

describe("servidor MCP (stdio)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    if (!existsSync(BIN)) {
      throw new Error(
        `No existe ${BIN}. Ejecuta \`npm run build\` antes de los tests.`,
      );
    }
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      // Sin API key a propósito: el servidor debe arrancar igualmente y el
      // error solo aparecer al invocar una tool que llame a AEMET.
      env: { PATH: process.env.PATH ?? "" },
    });
    client = new Client({ name: "aemet-mcp-test", version: "0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("arranca y completa el handshake sin AEMET_API_KEY", () => {
    expect(client.getServerVersion()?.name).toBe("aemet-mcp");
  });

  it("anuncia la misma versión que package.json", () => {
    // Evita que vuelva a divergir una versión escrita a mano en el código.
    expect(client.getServerVersion()?.version).toBe(PKG.version);
  });

  it("registra exactamente las herramientas esperadas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(HERRAMIENTAS);
  });

  it("cada herramienta declara descripción y schemas de entrada y salida", async () => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.description, `${t.name} sin descripción`).toBeTruthy();
      expect(t.inputSchema, `${t.name} sin inputSchema`).toBeTruthy();
      expect(t.outputSchema, `${t.name} sin outputSchema`).toBeTruthy();
    }
  });

  it("una tool sin dependencia de AEMET devuelve structuredContent válido", async () => {
    const res = await client.callTool({
      name: "buscar_municipio",
      arguments: { nombre: "El Campello" },
    });
    // Si el structuredContent no casara con el outputSchema, el propio SDK
    // habría rechazado la respuesta antes de llegar aquí.
    const datos = res.structuredContent as {
      consulta: string;
      total: number;
      municipios: Array<{
        codigo: string;
        nombre: string;
        provincia: string;
        isla: string | null;
      }>;
    };
    expect(datos.consulta).toBe("El Campello");
    expect(datos.municipios[0]).toMatchObject({
      codigo: "03050",
      nombre: "el Campello",
      provincia: "Alicante",
      isla: null,
    });
  });

  it("cada tool declara como requeridos los campos que de verdad lo son", async () => {
    const { tools } = await client.listTools();
    const requeridos = Object.fromEntries(
      tools.map((t) => [t.name, (t.inputSchema as { required?: string[] }).required ?? []]),
    );

    expect(requeridos["buscar_municipio"]).toEqual(["nombre"]);
    expect(requeridos["buscar_estacion"]).toEqual(["consulta"]);
    expect(requeridos["prediccion_diaria"]).toEqual(["municipio"]);
    expect(requeridos["prediccion_horaria"]).toEqual(["municipio"]);
    expect(requeridos["observacion_municipio"]).toEqual(["municipio"]);
    expect(requeridos["avisos"]).toEqual(["area"]);
    expect(requeridos["avisos_municipio"]).toEqual(["municipio"]);
    // observacion_estacion funciona sin argumentos (usa Madrid-Retiro).
    expect(requeridos["observacion_estacion"]).toEqual([]);
  });

  it("los outputSchema declaran las propiedades que promete cada tool", async () => {
    const { tools } = await client.listTools();
    const props = (nombre: string) =>
      Object.keys(
        (tools.find((t) => t.name === nombre)!.outputSchema as {
          properties?: Record<string, unknown>;
        }).properties ?? {},
      ).sort();

    expect(props("buscar_municipio")).toEqual(["consulta", "isla", "municipios", "total"]);
    expect(props("prediccion_diaria")).toEqual([
      "dias",
      "elaborado",
      "municipio",
      "unidades",
    ]);
    expect(props("avisos_municipio")).toContain("alcance");
    expect(props("observacion_municipio")).toContain("candidatas");
  });

  it("las respuestas con magnitudes declaran sus unidades en el payload", async () => {
    // El schema documenta las unidades, pero en una sesión real el modelo ve el
    // JSON y no el schema: un `velocidad: 9` sin unidad no es interpretable.
    const { tools } = await client.listTools();
    for (const nombre of [
      "prediccion_diaria",
      "prediccion_horaria",
      "observacion_estacion",
      "observacion_municipio",
    ]) {
      const schema = tools.find((t) => t.name === nombre)!.outputSchema as {
        properties?: Record<string, unknown>;
      };
      expect(Object.keys(schema.properties ?? {}), nombre).toContain("unidades");
    }
  });

  it("observacion_municipio promete la señal de que el dato no es del municipio", async () => {
    // Sin esto, la respuesta de Ceuta (estación de Tarifa, a 29,7 km y en otra
    // provincia) era indistinguible de una estación dentro del pueblo.
    const { tools } = await client.listTools();
    const props = Object.keys(
      (tools.find((t) => t.name === "observacion_municipio")!.outputSchema as {
        properties?: Record<string, unknown>;
      }).properties ?? {},
    );
    expect(props).toContain("advertencia");
    expect(props).toContain("representaAlMunicipio");
  });

  it("acepta acotar la predicción por rango de fechas", async () => {
    const { tools } = await client.listTools();
    const entrada = (nombre: string) =>
      Object.keys(
        (tools.find((t) => t.name === nombre)!.inputSchema as {
          properties?: Record<string, unknown>;
        }).properties ?? {},
      );
    expect(entrada("prediccion_diaria")).toEqual(
      expect.arrayContaining(["desde", "hasta"]),
    );
    expect(entrada("avisos_municipio")).toContain("incluirComunidad");
  });

  it("una isla se explica como tal en vez de dar coincidencias por subcadena", async () => {
    // No necesita API key: la resolución del municipio es local.
    const res = await client.callTool({
      name: "prediccion_diaria",
      arguments: { municipio: "El Hierro" },
    });
    expect(res.isError).toBe(true);
    const texto = JSON.stringify(res.content);
    expect(texto).toContain("ISLA");
    expect(texto).toContain("Valverde"); // no contiene "Hierro" y antes se perdía
    expect(texto).not.toContain("Cueva del Hierro"); // ruido de Cuenca
  });

  it("buscar_municipio devuelve la isla de cada municipio insular", async () => {
    const res = await client.callTool({
      name: "buscar_municipio",
      arguments: { nombre: "Valverde" },
    });
    const datos = res.structuredContent as {
      municipios: Array<{ codigo: string; isla: string | null }>;
    };
    // El caso del informe: 15 "Valverde" y ninguna pista de cuál es el de la isla.
    expect(datos.municipios[0]).toMatchObject({ codigo: "38048", isla: "El Hierro" });
    expect(datos.municipios.some((m) => m.isla === null)).toBe(true);
  });

  it("un argumento del tipo equivocado se rechaza antes de llamar a AEMET", async () => {
    const res = await client.callTool({
      name: "prediccion_diaria",
      arguments: { municipio: "Madrid", dias: "muchos" },
    });
    expect(res.isError).toBe(true);
  });

  it("un nombre ambiguo devuelve las opciones con provincia, sin necesitar API key", async () => {
    // La resolución del municipio ocurre antes de tocar el cliente de AEMET,
    // así que este camino se puede probar entero sin credenciales.
    const res = await client.callTool({
      name: "prediccion_diaria",
      arguments: { municipio: "La Zarza" },
    });
    expect(res.isError).toBe(true);
    const texto = JSON.stringify(res.content);
    expect(texto).toContain("ambiguo");
    expect(texto).toContain("Badajoz");
    expect(texto).toContain("Valladolid");
  });

  it("un municipio inexistente da un mensaje útil, no un fallo opaco", async () => {
    const res = await client.callTool({
      name: "prediccion_diaria",
      arguments: { municipio: "99999" },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("buscar_municipio");
  });

  const NECESITAN_AEMET = [
    ["buscar_estacion", { consulta: "Retiro" }],
    ["observacion_estacion", {}],
    ["observacion_municipio", { municipio: "Madrid" }],
    ["prediccion_diaria", { municipio: "Madrid" }],
    ["prediccion_horaria", { municipio: "Madrid" }],
    ["avisos", { area: "Andalucía" }],
    ["avisos_municipio", { municipio: "Madrid" }],
  ] as const;

  for (const [nombre, args] of NECESITAN_AEMET) {
    it(`${nombre} sin API key falla con MISSING_API_KEY, no revienta`, async () => {
      const res = await client.callTool({ name: nombre, arguments: args });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("MISSING_API_KEY");
    });
  }

  it("una tool sin dependencia de AEMET responde con la key ausente", async () => {
    const res = await client.callTool({
      name: "buscar_municipio",
      arguments: { nombre: "Madrid" },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain("Madrid");
  });
});

describe("el logging no contamina el canal MCP", () => {
  it("con AEMET_MCP_LOG=debug el handshake sigue funcionando", async () => {
    // stdout es el transporte JSON-RPC: una sola línea de log ahí rompe la
    // sesión. Este test la rompería si el logger dejara de ir a stderr.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      env: { PATH: process.env.PATH ?? "", AEMET_MCP_LOG: "debug" },
    });
    const client = new Client({ name: "aemet-mcp-test-log", version: "0" });
    await client.connect(transport);

    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(HERRAMIENTAS.length);

      const res = await client.callTool({
        name: "buscar_municipio",
        arguments: { nombre: "Madrid" },
      });
      expect(res.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  }, 30_000);
});
