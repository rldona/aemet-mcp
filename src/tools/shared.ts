import type { AemetClient } from "../aemet/client.js";
import { AemetError } from "../aemet/errors.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Getter perezoso del cliente: construirlo lanza si falta AEMET_API_KEY. */
export type GetClient = () => AemetClient;

export type { CallToolResult };

export function text(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }] };
}

export function errorText(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }], isError: true };
}

/**
 * Envuelve el handler de una tool: traduce errores a texto legible para el LLM
 * en vez de propagar excepciones (que el cliente MCP mostraría como fallo opaco).
 */
export function runTool(
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  return fn().catch((err: unknown) => {
    if (err instanceof AemetError) {
      return errorText(`Error de AEMET [${err.code}]: ${err.message}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return errorText(msg);
  });
}
