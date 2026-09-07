import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolverArea, areaParaMunicipio, AREAS } from "../aemet/areas.js";
import { resolverMunicipio } from "../aemet/municipios.js";
import { coordenadasMunicipio } from "../aemet/geo.js";
import { avisosParaPunto, obtenerAvisos } from "../aemet/avisos.js";
import { formatAvisos, formatAvisosMunicipio } from "../aemet/format.js";
import { runTool, structured, type GetClient } from "./shared.js";
import {
  aSalidaAvisos,
  aSalidaAvisosMunicipio,
  salidaAvisos,
  salidaAvisosMunicipio,
} from "./schemas.js";

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
      outputSchema: salidaAvisos,
    },
    async ({ area }) =>
      runTool(async () => {
        const ccaa = resolverArea(area);
        const resultado = await obtenerAvisos(getClient(), ccaa.codigo);
        return structured(
          formatAvisos(ccaa.nombre, resultado),
          aSalidaAvisos(ccaa, resultado),
        );
      }),
  );
}

export function registerAvisosMunicipio(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "avisos_municipio",
    {
      title: "Avisos meteorológicos de un municipio",
      description:
        "Avisos meteorológicos vigentes que afectan a un municipio español concreto. " +
        "Resuelve la comunidad autónoma sola y, cuando AEMET publica la geometría de " +
        "las zonas de aviso, filtra por el punto del municipio en lugar de devolver " +
        "los de toda la comunidad. Preferible a `avisos` cuando se pregunta por un " +
        "pueblo o ciudad concretos.",
      inputSchema: {
        municipio: z
          .string()
          .min(1)
          .describe(
            "Municipio: nombre ('Granada', 'El Campello') o código INE de 5 dígitos.",
          ),
      },
      outputSchema: salidaAvisosMunicipio,
    },
    async ({ municipio }) =>
      runTool(async () => {
        const client = getClient();
        const m = resolverMunicipio(municipio);

        const ccaa = areaParaMunicipio(m.codigo);
        if (!ccaa) {
          throw new Error(
            `No se pudo determinar la comunidad autónoma de ${m.nombreNatural} (${m.codigo}).`,
          );
        }

        const resultado = await obtenerAvisos(client, ccaa.codigo);

        // Sin coordenadas no hay filtro posible: se devuelven los de la CCAA
        // diciéndolo, que es preferible a ocultar un aviso rojo.
        const punto = await coordenadasMunicipio(client, m.codigo);
        if (!punto) {
          return structured(
            formatAvisosMunicipio(m, ccaa, resultado, resultado.avisos, "comunidad"),
            aSalidaAvisosMunicipio(m, ccaa, resultado, resultado.avisos, "comunidad"),
          );
        }

        const { dentro, sinGeometria } = avisosParaPunto(resultado.avisos, punto);
        const avisos = [...dentro, ...sinGeometria];
        const alcance = sinGeometria.length > 0 ? "comunidad" : "municipio";

        return structured(
          formatAvisosMunicipio(m, ccaa, resultado, avisos, alcance),
          aSalidaAvisosMunicipio(m, ccaa, resultado, avisos, alcance),
        );
      }),
  );
}
