import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buscarMunicipios } from "../aemet/municipios.js";
import { formatMunicipios } from "../aemet/format.js";
import { runTool, structured } from "./shared.js";
import { aSalidaBuscarMunicipio, salidaBuscarMunicipio } from "./schemas.js";

export function registerBuscarMunicipio(server: McpServer): void {
  server.registerTool(
    "buscar_municipio",
    {
      title: "Buscar municipio",
      description:
        "Busca municipios españoles por nombre y devuelve su código INE de 5 dígitos " +
        "y su provincia. El match tolera acentos, mayúsculas y artículos: " +
        "'El Campello', 'Campello' y 'Campello, el' encuentran lo mismo.\n" +
        "NO hace falta llamarla antes de las demás: prediccion_diaria, " +
        "prediccion_horaria, observacion_municipio y avisos_municipio aceptan el " +
        "nombre directamente y lo resuelven solas. Úsala cuando el usuario pida " +
        "explícitamente el código INE, o cuando otra herramienta responda que el " +
        "nombre es ambiguo y necesites ver las opciones con su provincia.",
      inputSchema: {
        nombre: z
          .string()
          .min(1)
          .describe("Nombre del municipio a buscar, p. ej. 'Málaga' o 'San Sebastián'."),
      },
      outputSchema: salidaBuscarMunicipio,
    },
    async ({ nombre }) =>
      runTool(async () => {
        const resultados = buscarMunicipios(nombre);
        return structured(
          formatMunicipios(nombre, resultados),
          aSalidaBuscarMunicipio(nombre, resultados),
        );
      }),
  );
}
