import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * Entrypoint del servidor AEMET MCP.
 *
 * Fase 0: arranca un McpServer vacío por stdio.
 * Las herramientas (buscar_municipio, prediccion_*, observacion_estacion,
 * avisos) se registran en fases posteriores desde `src/tools/`.
 */
async function main(): Promise<void> {
  const server = new McpServer({
    name: "aemet-mcp",
    version: "0.1.0",
  });

  // TODO(fase 2): registrar herramientas MCP aquí.
  // registerMunicipioTools(server, deps)
  // registerPrediccionTools(server, deps)
  // registerObservacionTools(server, deps)
  // registerAvisosTools(server, deps)  // fase 3

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Importante: nada de logs en stdout — stdout es el canal del protocolo MCP.
  // Los diagnósticos van a stderr.
  console.error("[aemet-mcp] servidor iniciado (stdio)");
}

main().catch((error) => {
  console.error("[aemet-mcp] error fatal:", error);
  process.exit(1);
});
