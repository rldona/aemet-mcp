import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buscarMunicipios } from "../aemet/municipios.js";
import { formatMunicipios } from "../aemet/format.js";
import { runTool, text } from "./shared.js";

export function registerBuscarMunicipio(server: McpServer): void {
  server.registerTool(
    "buscar_municipio",
    {
      title: "Buscar municipio",
      description:
        "Busca municipios españoles por nombre y devuelve su código INE de 5 dígitos. " +
        "Úsala PRIMERO cuando el usuario dé un nombre de pueblo/ciudad, porque las " +
        "predicciones necesitan el código INE. El match tolera acentos y mayúsculas.",
      inputSchema: {
        nombre: z
          .string()
          .min(1)
          .describe("Nombre del municipio a buscar, p. ej. 'Málaga' o 'San Sebastián'."),
      },
    },
    async ({ nombre }) =>
      runTool(async () => {
        const resultados = buscarMunicipios(nombre);
        return text(formatMunicipios(nombre, resultados));
      }),
  );
}
