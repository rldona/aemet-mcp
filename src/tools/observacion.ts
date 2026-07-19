import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TTL } from "../aemet/client.js";
import { resolverEstacion } from "../aemet/estaciones.js";
import { formatObservacion } from "../aemet/format.js";
import type { Observacion } from "../aemet/types.js";
import { runTool, text, type GetClient } from "./shared.js";

/** Estación por defecto si no se indica ninguna: Madrid-Retiro. */
const DEFAULT_IDEMA = "3195";

export function registerObservacionTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "observacion_estacion",
    {
      title: "Observación de estación",
      description:
        "Última observación meteorológica convencional de una estación de AEMET: " +
        "temperatura, humedad, viento, precipitación y presión. Acepta el nombre de " +
        "la estación/ciudad o su identificador idema. Si se omite, usa Madrid-Retiro.",
      inputSchema: {
        estacion: z
          .string()
          .optional()
          .describe(
            "Identificador idema (p. ej. '3195') o nombre de estación/ciudad " +
              "(p. ej. 'Madrid, Retiro'). Si se omite, se usa Madrid-Retiro (3195).",
          ),
      },
    },
    async ({ estacion }) =>
      runTool(async () => {
        const client = getClient();
        let idema = DEFAULT_IDEMA;
        let nombre: string | undefined;

        if (estacion && estacion.trim()) {
          const est = await resolverEstacion(client, estacion);
          idema = est.idema;
          nombre = est.nombre;
        }

        const data = await client.fetchJson<Observacion[]>(
          `/observacion/convencional/datos/estacion/${idema}`,
          TTL.observacion,
        );
        return text(formatObservacion(data, nombre));
      }),
  );
}
