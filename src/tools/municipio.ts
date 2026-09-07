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
        "Busca municipios españoles por nombre y devuelve su código INE de 5 dígitos y su provincia. " +
        "Úsala PRIMERO cuando el usuario dé un nombre de pueblo/ciudad, porque las " +
        "predicciones necesitan el código INE. El match tolera acentos, mayúsculas y " +
        "artículos: 'El Campello', 'Campello' y 'Campello, el' encuentran lo mismo.",
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
