import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TTL } from "../aemet/client.js";
import { resolverEstacion, type EstacionResuelta } from "../aemet/estaciones.js";
import { formatObservacion, observacionMasReciente } from "../aemet/format.js";
import type { Observacion } from "../aemet/types.js";
import { runTool, structured, text, type GetClient } from "./shared.js";
import { aSalidaObservacion, salidaObservacion } from "./schemas.js";

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
        "Última observación meteorológica convencional de una ESTACIÓN concreta de " +
        "AEMET: temperatura, humedad, viento, precipitación y presión. Acepta el " +
        "nombre de la estación o su identificador idema; si se omite, usa " +
        "Madrid-Retiro.\n" +
        "Si lo que quieres es el tiempo actual de un pueblo o ciudad, usa " +
        "observacion_municipio: esta exige saber qué estación mide ese sitio, y " +
        "muchas estaciones del inventario no publican observación.",
      inputSchema: {
        estacion: z
          .string()
          .optional()
          .describe(
            "Identificador idema (p. ej. '3195') o nombre de estación/ciudad " +
              "(p. ej. 'Madrid, Retiro'). Si se omite, se usa Madrid-Retiro (3195).",
          ),
      },
      outputSchema: salidaObservacion,
    },
    async ({ estacion }) =>
      runTool(async () => {
        const client = getClient();
        let idema = DEFAULT_IDEMA;
        let est: EstacionResuelta | undefined;

        if (estacion && estacion.trim()) {
          est = await resolverEstacion(client, estacion);
          idema = est.idema;
        }

        const data = await client.fetchJson<Observacion[]>(
          `/observacion/convencional/datos/estacion/${idema}`,
          TTL.observacion,
        );
        const texto = formatObservacion(data, est?.nombre);
        const ultima = observacionMasReciente(data);
        if (!ultima) return text(texto);
        return structured(texto, aSalidaObservacion(ultima, est));
      }),
  );
}
