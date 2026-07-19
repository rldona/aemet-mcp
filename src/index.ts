import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AemetClient } from "./aemet/client.js";
import { registerBuscarMunicipio } from "./tools/municipio.js";
import { registerPrediccionTools } from "./tools/prediccion.js";
import { registerObservacionTool } from "./tools/observacion.js";
import type { GetClient } from "./tools/shared.js";

/**
 * Entrypoint del servidor AEMET MCP.
 *
 * Registra las herramientas y conecta por stdio. El cliente AEMET se construye
 * de forma perezosa: el servidor arranca y lista tools aunque falte la API key;
 * el error (MISSING_API_KEY) solo aparece al invocar una tool que llame a AEMET.
 */
async function main(): Promise<void> {
  const server = new McpServer({
    name: "aemet-mcp",
    version: "0.1.0",
  });

  const apiKey = process.env.AEMET_API_KEY ?? "";
  let client: AemetClient | null = null;
  const getClient: GetClient = () => {
    if (!client) client = new AemetClient({ apiKey }); // lanza si apiKey === ""
    return client;
  };

  registerBuscarMunicipio(server);
  registerPrediccionTools(server, getClient);
  registerObservacionTool(server, getClient);
  // TODO(fase 3): registerAvisosTool(server, getClient)

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout es el canal del protocolo MCP: los diagnósticos van a stderr.
  console.error("[aemet-mcp] servidor iniciado (stdio) — 4 herramientas");
}

main().catch((error) => {
  console.error("[aemet-mcp] error fatal:", error);
  process.exit(1);
});
