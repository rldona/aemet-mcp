import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TTL } from "../aemet/client.js";
import { AemetError } from "../aemet/errors.js";
import { resolverMunicipio } from "../aemet/municipios.js";
import { coordenadasMunicipio } from "../aemet/geo.js";
import { estacionesCercanas, type EstacionResuelta } from "../aemet/estaciones.js";
import { formatObservacionMunicipio, observacionMasReciente } from "../aemet/format.js";
import type { Observacion } from "../aemet/types.js";
import { runTool, structured, type GetClient } from "./shared.js";
import { aSalidaObservacionMunicipio, salidaObservacionMunicipio } from "./schemas.js";

/** Cuántas estaciones próximas se prueban antes de rendirse. */
const MAX_INTENTOS = 5;

export function registerObservacionMunicipio(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "observacion_municipio",
    {
      title: "Tiempo actual en un municipio",
      description:
        "Tiempo observado AHORA MISMO cerca de un municipio español: temperatura, " +
        "humedad, viento, precipitación y presión. Resuelve el municipio, busca las " +
        "estaciones más próximas y devuelve la observación de la más cercana con datos, " +
        "indicando a qué distancia está y de cuándo es el dato. Para el tiempo actual " +
        "es preferible a observacion_estacion, que exige saber la estación.",
      inputSchema: {
        municipio: z
          .string()
          .min(1)
          .describe(
            "Municipio: nombre ('Granada', 'El Campello') o código INE de 5 dígitos.",
          ),
        estacion: z
          .string()
          .optional()
          .describe(
            "Idema de una estación concreta de entre las candidatas, para forzarla " +
              "en lugar de usar la más cercana.",
          ),
      },
      outputSchema: salidaObservacionMunicipio,
    },
    async ({ municipio, estacion }) =>
      runTool(async () => {
        const client = getClient();
        const m = resolverMunicipio(municipio);

        const punto = await coordenadasMunicipio(client, m.codigo);
        if (!punto) {
          throw new Error(
            `AEMET no publica coordenadas para ${m.nombreNatural} (${m.codigo}), ` +
              `así que no se puede buscar su estación más cercana. Usa buscar_estacion ` +
              `y luego observacion_estacion.`,
          );
        }

        const candidatas = await estacionesCercanas(client, punto, MAX_INTENTOS);
        if (candidatas.length === 0) {
          throw new Error(
            "El inventario de AEMET no trae ninguna estación con coordenadas utilizables.",
          );
        }

        // Si se fuerza una estación, se prueba solo esa; si no, de la más
        // cercana hacia fuera. Muchas estaciones del inventario son solo
        // climatológicas y no publican observación: AEMET responde 404 y hay
        // que seguir con la siguiente en vez de dar el municipio por perdido.
        const orden = estacion
          ? candidatas.filter((c) => c.idema.toLowerCase() === estacion.trim().toLowerCase())
          : candidatas;

        if (estacion && orden.length === 0) {
          throw new Error(
            `La estación "${estacion}" no está entre las ${candidatas.length} más ` +
              `cercanas a ${m.nombreNatural}. Candidatas: ` +
              `${candidatas.map((c) => `${c.idema} (${c.nombre})`).join(", ")}.`,
          );
        }

        let elegida: (EstacionResuelta & { distanciaKm: number }) | undefined;
        let observacion: Observacion | undefined;

        for (const candidata of orden) {
          try {
            const datos = await client.fetchJson<Observacion[]>(
              `/observacion/convencional/datos/estacion/${candidata.idema}`,
              TTL.observacion,
            );
            const ultima = observacionMasReciente(datos);
            if (!ultima) continue;
            elegida = candidata;
            observacion = ultima;
            break;
          } catch (err) {
            // Sin datos para esa estación: se prueba la siguiente. Cualquier
            // otro fallo (red, cuota, key) sí debe salir a la superficie.
            if (err instanceof AemetError && err.code === "NOT_FOUND") continue;
            throw err;
          }
        }

        return structured(
          formatObservacionMunicipio(m, elegida, observacion, candidatas),
          aSalidaObservacionMunicipio(m, elegida, observacion, candidatas),
        );
      }),
  );
}
