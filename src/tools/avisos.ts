import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolverArea, AREAS } from "../aemet/areas.js";
import { obtenerAvisos } from "../aemet/avisos.js";
import { formatAvisos } from "../aemet/format.js";
import { runTool, text, type GetClient } from "./shared.js";

export function registerAvisosTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "avisos",
    {
      title: "Avisos meteorológicos",
      description:
        "Avisos meteorológicos vigentes (temperaturas, lluvia, viento, tormentas, " +
        "costeros, etc.) de una comunidad autónoma española, con su nivel " +
        "(amarillo/naranja/rojo), zona afectada y periodo. Fuente: avisos CAP de AEMET.",
      inputSchema: {
        area: z
          .string()
          .min(1)
          .describe(
            "Comunidad autónoma: nombre (p. ej. 'Cataluña', 'Andalucía') o código " +
              `de área de 2 dígitos. Válidas: ${AREAS.map((a) => a.nombre).join(", ")}.`,
          ),
      },
    },
    async ({ area }) =>
      runTool(async () => {
        const ccaa = resolverArea(area);
        const resultado = await obtenerAvisos(getClient(), ccaa.codigo);
        return text(formatAvisos(ccaa.nombre, resultado));
      }),
  );
}
