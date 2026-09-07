import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TTL } from "../aemet/client.js";
import { resolverMunicipio } from "../aemet/municipios.js";
import { formatDiaria, formatHoraria } from "../aemet/format.js";
import type {
  PrediccionDiariaMunicipio,
  PrediccionHorariaMunicipio,
} from "../aemet/types.js";
import { runTool, structured, type GetClient } from "./shared.js";
import {
  aSalidaPrediccionDiaria,
  aSalidaPrediccionHoraria,
  salidaPrediccionDiaria,
  salidaPrediccionHoraria,
} from "./schemas.js";

const municipioArg = z
  .string()
  .min(1)
  .describe(
    "Municipio: nombre (p. ej. 'Madrid') o código INE de 5 dígitos (p. ej. '28079'). " +
      "Si el nombre es ambiguo, usa antes buscar_municipio para obtener el código.",
  );

export function registerPrediccionTools(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "prediccion_diaria",
    {
      title: "Predicción diaria",
      description:
        "Predicción meteorológica diaria (hasta 7 días) de un municipio español: " +
        "temperatura máx/mín, estado del cielo, probabilidad de precipitación y viento.",
      inputSchema: {
        municipio: municipioArg,
        dias: z
          .number()
          .int()
          .min(1)
          .max(7)
          .optional()
          .describe("Número de días a incluir (1-7). Por defecto 7."),
      },
      outputSchema: salidaPrediccionDiaria,
    },
    async ({ municipio, dias }) =>
      runTool(async () => {
        const m = resolverMunicipio(municipio);
        const data = await getClient().fetchJson<PrediccionDiariaMunicipio[]>(
          `/prediccion/especifica/municipio/diaria/${m.codigo}`,
          TTL.prediccion,
        );
        const pred = data[0];
        if (!pred) throw new Error(`AEMET no devolvió predicción para ${m.nombre} (${m.codigo}).`);
        const n = dias ?? 7;
        return structured(
          formatDiaria(pred, n),
          aSalidaPrediccionDiaria(m, pred, n),
        );
      }),
  );

  server.registerTool(
    "prediccion_horaria",
    {
      title: "Predicción horaria",
      description:
        "Predicción meteorológica hora a hora de un municipio español para el día en " +
        "curso y los siguientes: temperatura, cielo, precipitación y viento por hora.",
      inputSchema: {
        municipio: municipioArg,
        dias: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe("Días a incluir (1-2): hoy y mañana. Por defecto 2."),
      },
      outputSchema: salidaPrediccionHoraria,
    },
    async ({ municipio, dias }) =>
      runTool(async () => {
        const m = resolverMunicipio(municipio);
        const data = await getClient().fetchJson<PrediccionHorariaMunicipio[]>(
          `/prediccion/especifica/municipio/horaria/${m.codigo}`,
          TTL.prediccion,
        );
        const pred = data[0];
        if (!pred) throw new Error(`AEMET no devolvió predicción para ${m.nombre} (${m.codigo}).`);
        const n = dias ?? 2;
        return structured(
          formatHoraria(pred, n),
          aSalidaPrediccionHoraria(m, pred, n),
        );
      }),
  );
}
