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
  "buscar_municipio",
  "observacion_estacion",
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

  it("cada herramienta declara descripción y schema de entrada", async () => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.description, `${t.name} sin descripción`).toBeTruthy();
      expect(t.inputSchema, `${t.name} sin inputSchema`).toBeTruthy();
    }
  });

  it("una tool que necesita AEMET falla con MISSING_API_KEY, no revienta", async () => {
    const res = await client.callTool({
      name: "observacion_estacion",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("MISSING_API_KEY");
  });

  it("una tool sin dependencia de AEMET responde con la key ausente", async () => {
    const res = await client.callTool({
      name: "buscar_municipio",
      arguments: { nombre: "Madrid" },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain("Madrid");
  });
});
