import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TTL } from "../aemet/client.js";
import { AemetError } from "../aemet/errors.js";
import { resolverMunicipio } from "../aemet/municipios.js";
import { coordenadasMunicipio } from "../aemet/geo.js";
import { estacionesCercanas } from "../aemet/estaciones.js";
import { formatObservacionMunicipio, observacionMasReciente } from "../aemet/format.js";
import type { Observacion } from "../aemet/types.js";
import { runTool, structured, type GetClient } from "./shared.js";
import {
  aSalidaObservacionMunicipio,
  evaluarEstacion,
  salidaObservacionMunicipio,
  type Candidata,
  type EstadoCandidata,
} from "./schemas.js";

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
        "estaciones más próximas y devuelve la observación de la más cercana con datos.\n" +
        "IMPORTANTE: el dato es de una ESTACIÓN, no del municipio. Si la estación " +
        "está lejos o en otra provincia, la respuesta trae `advertencia` y " +
        "`representaAlMunicipio: false`; en ese caso hay que decírselo al usuario en " +
        "vez de presentar la temperatura como si fuera la de su pueblo.\n" +
        "Para el tiempo actual es preferible a observacion_estacion, que exige saber " +
        "la estación.",
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
              "en lugar de usar la más cercana. Si esa estación no publica " +
              "observación, se dice explícitamente en vez de devolver nulos.",
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
        const forzada = estacion?.trim();
        const orden = forzada
          ? candidatas.filter((c) => c.idema.toLowerCase() === forzada.toLowerCase())
          : candidatas;

        if (forzada && orden.length === 0) {
          throw new Error(
            `La estación "${forzada}" no está entre las ${candidatas.length} más ` +
              `cercanas a ${m.nombreNatural}. Candidatas: ` +
              `${candidatas.map((c) => `${c.idema} (${c.nombre})`).join(", ")}.`,
          );
        }

        // Lo que se ha comprobado de cada candidata. Se prueban en orden y se
        // para en la primera con datos, así que de las siguientes no se sabe
        // nada: decir "sin datos" de una que no se ha consultado sería mentir.
        const estados = new Map<string, EstadoCandidata>();
        let elegida: Candidata | undefined;
        let observacion: Observacion | undefined;

        for (const candidata of orden) {
          try {
            const datos = await client.fetchJson<Observacion[]>(
              `/observacion/convencional/datos/estacion/${candidata.idema}`,
              TTL.observacion,
            );
            const ultima = observacionMasReciente(datos);
            if (!ultima) {
              estados.set(candidata.idema, "sin datos");
              continue;
            }
            estados.set(candidata.idema, "con datos");
            elegida = candidata;
            observacion = ultima;
            break;
          } catch (err) {
            // Sin datos para esa estación: se prueba la siguiente. Cualquier
            // otro fallo (red, cuota, key) sí debe salir a la superficie.
            if (err instanceof AemetError && err.code === "NOT_FOUND") {
              estados.set(candidata.idema, "sin datos");
              continue;
            }
            throw err;
          }
        }

        // Antes esto devolvía la estructura entera a null sin marcar error, y no
        // había forma de distinguir "esta estación no publica" de "el servidor
        // se ha roto". Ahora se dice cuál es el caso.
        if (!elegida || !observacion) {
          throw new Error(sinDatos(m.nombreNatural, forzada, orden, candidatas));
        }

        const { advertencia } = evaluarEstacion(m, elegida);

        return structured(
          formatObservacionMunicipio(m, elegida, observacion, candidatas, advertencia),
          aSalidaObservacionMunicipio(m, elegida, observacion, candidatas, estados),
        );
      }),
  );
}

/** Mensaje del caso "no hay observación", distinguiendo forzada de automática. */
function sinDatos(
  municipio: string,
  forzada: string | undefined,
  probadas: Candidata[],
  candidatas: Candidata[],
): string {
  if (forzada) {
    const est = probadas[0];
    return (
      `La estación ${forzada}${est ? ` (${est.nombre})` : ""} existe y está entre las ` +
      `más cercanas a ${municipio}, pero NO publica observación: muchas estaciones ` +
      `del inventario son solo climatológicas. No es un fallo del servidor.\n` +
      `Prueba sin forzar estación, o con otra de estas: ` +
      `${candidatas
        .filter((c) => c.idema.toLowerCase() !== forzada.toLowerCase())
        .map((c) => `${c.idema} (${c.nombre}, ${c.distanciaKm.toFixed(1)} km)`)
        .join("; ")}.`
    );
  }
  const lista = candidatas
    .map((c) => `  - ${c.nombre} (${c.idema}, a ${c.distanciaKm.toFixed(1)} km)`)
    .join("\n");
  return (
    `Ninguna de las ${candidatas.length} estaciones más cercanas a ${municipio} ` +
    `publica observación ahora mismo:\n${lista}\n` +
    `Es un hueco de datos de AEMET, no un fallo del servidor. Para la previsión de ` +
    `hoy puedes usar prediccion_horaria.`
  );
}
