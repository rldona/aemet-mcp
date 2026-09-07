// Logging diagnóstico.
//
// Dos reglas que no son negociables aquí:
//
// 1. TODO va a stderr. `stdout` es el canal del protocolo MCP: una sola línea
//    suelta ahí corrompe el flujo JSON-RPC y el cliente se desconecta.
// 2. Nunca se registran credenciales. Las cabeceras no se tocan, y de las URL se
//    borra la query, porque las de descarga de AEMET pueden llevar token.
//
// Por defecto solo se ven avisos y errores. Las métricas (duración, reintentos,
// aciertos de caché) salen en `debug`, que se activa con AEMET_MCP_LOG=debug.

export type NivelLog = "silent" | "error" | "warn" | "info" | "debug";

const ORDEN: Record<NivelLog, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/** Campos extra de una línea de log. `undefined` se omite. */
export type Campos = Record<string, string | number | boolean | undefined>;

export interface Logger {
  error(mensaje: string, campos?: Campos): void;
  warn(mensaje: string, campos?: Campos): void;
  info(mensaje: string, campos?: Campos): void;
  debug(mensaje: string, campos?: Campos): void;
  /** ¿Merece la pena calcular datos caros para este nivel? */
  habilitado(nivel: NivelLog): boolean;
}

/** Lee AEMET_MCP_LOG. Un valor desconocido no rompe: cae al nivel por defecto. */
export function nivelDesdeEntorno(
  valor = process.env.AEMET_MCP_LOG,
  porDefecto: NivelLog = "warn",
): NivelLog {
  const v = (valor ?? "").trim().toLowerCase();
  return v in ORDEN ? (v as NivelLog) : porDefecto;
}

/**
 * Quita la query de una URL para no arrastrar tokens al log. Si no se puede
 * parsear, se devuelve recortada en lugar de entera.
 */
export function urlSegura(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.slice(0, 120);
  }
}

function formatear(nivel: NivelLog, mensaje: string, campos?: Campos): string {
  const extra = Object.entries(campos ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`)
    .join(" ");
  return `[aemet-mcp] ${nivel} ${mensaje}${extra ? ` ${extra}` : ""}`;
}

/**
 * Crea un logger. `escribir` es inyectable para tests; por defecto
 * `console.error`, que va a stderr.
 */
export function crearLogger(
  nivel: NivelLog = nivelDesdeEntorno(),
  escribir: (linea: string) => void = (l) => console.error(l),
): Logger {
  const umbral = ORDEN[nivel];
  const emitir = (n: NivelLog) => (mensaje: string, campos?: Campos) => {
    if (ORDEN[n] > umbral) return;
    escribir(formatear(n, mensaje, campos));
  };

  return {
    error: emitir("error"),
    warn: emitir("warn"),
    info: emitir("info"),
    debug: emitir("debug"),
    habilitado: (n) => ORDEN[n] <= umbral,
  };
}

/** Logger por defecto del proceso, configurado desde el entorno. */
export const log: Logger = crearLogger();
