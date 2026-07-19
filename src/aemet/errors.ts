// Errores tipados del cliente AEMET. Las herramientas MCP los traducen a
// mensajes claros para el LLM en lugar de propagar stack traces crudos.

export type AemetErrorCode =
  | "MISSING_API_KEY" // no hay AEMET_API_KEY en el entorno
  | "UNAUTHORIZED" // estado 401: key inválida o caducada
  | "NOT_FOUND" // estado 404: no hay datos para el recurso
  | "RATE_LIMITED" // estado 429: too many requests
  | "UPSTREAM" // otro estado inesperado de AEMET
  | "NETWORK" // fallo de red / fetch
  | "TIMEOUT" // la petición excedió el tiempo máximo
  | "TOO_LARGE" // la respuesta supera el tamaño máximo aceptado
  | "UNSAFE_URL" // AEMET apuntó a una URL a la que no se envía la API key
  | "PARSE"; // respuesta no parseable

export class AemetError extends Error {
  readonly code: AemetErrorCode;
  /** Código `estado` de AEMET o status HTTP asociado, si aplica. */
  readonly status?: number;

  constructor(code: AemetErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AemetError";
    this.code = code;
    this.status = status;
  }
}

/** Mensaje legible por defecto para cada código de estado de AEMET. */
export function describeEstado(estado: number, descripcion?: string): string {
  const base = descripcion ? `${descripcion} (estado ${estado})` : `estado ${estado}`;
  switch (estado) {
    case 401:
      return `API key inválida o no autorizada: ${base}. Revisa AEMET_API_KEY.`;
    case 404:
      return `AEMET no tiene datos para el recurso solicitado: ${base}.`;
    case 429:
      return `Límite de peticiones de AEMET superado: ${base}. Reintenta más tarde.`;
    default:
      return `Respuesta inesperada de AEMET: ${base}.`;
  }
}
