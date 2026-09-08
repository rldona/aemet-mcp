import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TTL } from "../aemet/client.js";
import { resolverMunicipio } from "../aemet/municipios.js";
import { formatDiaria, formatHoraria, seleccionarDias } from "../aemet/format.js";
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
      "Llama directamente con el nombre: si resulta ambiguo, la respuesta trae las " +
      "opciones con provincia y código. No hace falta buscar_municipio antes.",
  );

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const desdeArg = z
  .string()
  .regex(FECHA, "Formato de fecha YYYY-MM-DD")
  .optional()
  .describe(
    "Primer día a incluir, YYYY-MM-DD. Con `hasta`, acota el rango: para 'este " +
      "fin de semana' pide solo esos dos días en vez de traerte los siete.",
  );

const hastaArg = z
  .string()
  .regex(FECHA, "Formato de fecha YYYY-MM-DD")
  .optional()
  .describe("Último día a incluir, YYYY-MM-DD (inclusive).");

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
        "temperatura máx/mín, estado del cielo, probabilidad de precipitación y viento. " +
        "Acepta el nombre del municipio directamente ('Granada', 'El Campello') o su " +
        "código INE; si el nombre resulta ambiguo devuelve las opciones con su " +
        "provincia y su código para que reintentes con el correcto. Acota con `desde`/" +
        "`hasta` si solo te interesan unos días (p. ej. un fin de semana). Para el " +
        "tiempo que hace AHORA usa observacion_municipio, no esta.",
      inputSchema: {
        municipio: municipioArg,
        dias: z
          .number()
          .int()
          .min(1)
          .max(7)
          .optional()
          .describe("Número de días a incluir (1-7). Por defecto 7."),
        desde: desdeArg,
        hasta: hastaArg,
      },
      outputSchema: salidaPrediccionDiaria,
    },
    async ({ municipio, dias, desde, hasta }) =>
      runTool(async () => {
        const m = resolverMunicipio(municipio);
        const data = await getClient().fetchJson<PrediccionDiariaMunicipio[]>(
          `/prediccion/especifica/municipio/diaria/${m.codigo}`,
          TTL.prediccion,
        );
        const pred = data[0];
        if (!pred) throw new Error(`AEMET no devolvió predicción para ${m.nombre} (${m.codigo}).`);
        const seleccion = seleccionarDias(pred.prediccion?.dia ?? [], {
          max: dias ?? 7,
          desde,
          hasta,
        });
        return structured(
          formatDiaria(m, pred, seleccion),
          aSalidaPrediccionDiaria(m, pred, seleccion),
        );
      }),
  );

  server.registerTool(
    "prediccion_horaria",
    {
      title: "Predicción horaria",
      description:
        "Predicción meteorológica hora a hora de un municipio español para el día en " +
        "curso y los siguientes: temperatura, cielo, precipitación y viento por hora. " +
        "Acepta el nombre del municipio o su código INE, igual que prediccion_diaria. " +
        "Úsala cuando importe el detalle por horas (a qué hora llueve, cuándo refresca); " +
        "para varios días seguidos es mejor prediccion_diaria.",
      inputSchema: {
        municipio: municipioArg,
        dias: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe("Días a incluir (1-2): hoy y mañana. Por defecto 2."),
        desde: desdeArg,
        hasta: hastaArg,
      },
      outputSchema: salidaPrediccionHoraria,
    },
    async ({ municipio, dias, desde, hasta }) =>
      runTool(async () => {
        const m = resolverMunicipio(municipio);
        const data = await getClient().fetchJson<PrediccionHorariaMunicipio[]>(
          `/prediccion/especifica/municipio/horaria/${m.codigo}`,
          TTL.prediccion,
        );
        const pred = data[0];
        if (!pred) throw new Error(`AEMET no devolvió predicción para ${m.nombre} (${m.codigo}).`);
        const seleccion = seleccionarDias(pred.prediccion?.dia ?? [], {
          max: dias ?? 2,
          desde,
          hasta,
        });
        return structured(
          formatHoraria(m, pred, seleccion),
          aSalidaPrediccionHoraria(m, pred, seleccion),
        );
      }),
  );
}
