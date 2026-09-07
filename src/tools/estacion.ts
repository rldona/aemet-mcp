import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buscarEstaciones } from "../aemet/estaciones.js";
import { formatEstaciones } from "../aemet/format.js";
import { runTool, structured, type GetClient } from "./shared.js";
import { aSalidaBuscarEstacion, salidaBuscarEstacion } from "./schemas.js";

export function registerBuscarEstacion(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "buscar_estacion",
    {
      title: "Buscar estación meteorológica",
      description:
        "Busca estaciones meteorológicas de AEMET por nombre, provincia o identificador " +
        "idema, y devuelve sus coordenadas y altitud. Úsala para encontrar el idema que " +
        "necesita observacion_estacion cuando el nombre sea ambiguo o no lo sepas. " +
        "Para el tiempo actual de un municipio es más directo observacion_municipio.",
      inputSchema: {
        consulta: z
          .string()
          .min(1)
          .describe(
            "Nombre de estación o ciudad ('Retiro', 'Barajas'), provincia ('MADRID') " +
              "o identificador idema ('3195').",
          ),
        limite: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Máximo de estaciones a devolver (1-50). Por defecto 20."),
      },
      outputSchema: salidaBuscarEstacion,
    },
    async ({ consulta, limite }) =>
      runTool(async () => {
        const estaciones = await buscarEstaciones(getClient(), consulta, limite ?? 20);
        return structured(
          formatEstaciones(consulta, estaciones),
          aSalidaBuscarEstacion(consulta, estaciones),
        );
      }),
  );
}
