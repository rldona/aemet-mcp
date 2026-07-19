import { AemetError, describeEstado } from "./errors.js";
import { TtlCache } from "./cache.js";
import type { AemetEnvelope } from "./types.js";

const BASE_URL = "https://opendata.aemet.es/opendata/api";

/** TTL por defecto (ms). */
export const TTL = {
  prediccion: 10 * 60_000, // ~10 min
  observacion: 5 * 60_000, // ~5 min
  inventario: 24 * 60 * 60_000, // 24 h: el inventario cambia rara vez
} as const;

export interface AemetClientOptions {
  apiKey: string;
  /** Inyectable para tests. Por defecto el fetch global de Node. */
  fetchImpl?: typeof fetch;
  /** Reintentos ante 429. Por defecto 3. */
  maxRetries?: number;
  /** Base del backoff exponencial en ms. Por defecto 500. */
  backoffBaseMs?: number;
  /** Inyectable para tests: espera de backoff. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cliente de la API OpenData de AEMET.
 *
 * Encapsula el patrón de DOS PASOS de AEMET:
 *   1) GET al endpoint -> sobre JSON `{ estado, descripcion, datos, metadatos }`.
 *   2) GET a la URL de `datos` -> contenido real (habitualmente latin1).
 *
 * Mapea los códigos `estado` (200/401/404/429/otros) a `AemetError` tipados y
 * reintenta con backoff exponencial ante 429.
 */
export class AemetClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache = new TtlCache<unknown>(TTL.prediccion);

  constructor(opts: AemetClientOptions) {
    if (!opts.apiKey) {
      throw new AemetError(
        "MISSING_API_KEY",
        "Falta la API key de AEMET. Define la variable de entorno AEMET_API_KEY.",
      );
    }
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * Ejecuta el patrón de dos pasos y devuelve el contenido de `datos` como texto
   * decodificado. `decode` controla el charset (AEMET sirve latin1 casi siempre).
   */
  private async fetchDatosText(
    path: string,
    decode: "latin1" | "utf-8" = "latin1",
  ): Promise<string> {
    const envelope = await this.fetchEnvelope(path);
    if (!envelope.datos) {
      throw new AemetError(
        "UPSTREAM",
        `AEMET devolvió estado 200 pero sin URL de datos para ${path}.`,
        envelope.estado,
      );
    }
    const bytes = await this.fetchBytes(envelope.datos);
    return new TextDecoder(decode).decode(bytes);
  }

  /** Igual que fetchDatosText pero devuelve los bytes crudos (para tar.gz/CAP). */
  async fetchDatosBytes(path: string): Promise<Uint8Array> {
    const envelope = await this.fetchEnvelope(path);
    if (!envelope.datos) {
      throw new AemetError(
        "UPSTREAM",
        `AEMET devolvió estado 200 pero sin URL de datos para ${path}.`,
        envelope.estado,
      );
    }
    return this.fetchBytes(envelope.datos);
  }

  /**
   * Patrón de dos pasos + JSON. Decodifica latin1 y parsea. Cachea por `path`.
   */
  async fetchJson<T>(path: string, ttlMs?: number): Promise<T> {
    return this.cache.getOrLoad(
      `json:${path}`,
      async () => {
        const text = await this.fetchDatosText(path, "latin1");
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new AemetError(
            "PARSE",
            `No se pudo parsear como JSON la respuesta de ${path}.`,
          );
        }
      },
      ttlMs,
    ) as Promise<T>;
  }

  /**
   * fetch con reintentos ante fallos de red TRANSITORIOS (el servidor de datos
   * de AEMET corta conexiones de vez en cuando). No reintenta errores HTTP: de
   * esos se encarga la lógica de `estado`.
   */
  private async doFetch(
    url: string,
    init: RequestInit,
    contexto: string,
    retryHttp5xx = false,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, init);
        // 5xx en el servidor de datos suele ser transitorio: reintentamos.
        if (retryHttp5xx && res.status >= 500 && attempt < this.maxRetries) {
          await this.sleep(this.backoffBaseMs * 2 ** attempt);
          continue;
        }
        return res;
      } catch (cause) {
        lastError = cause;
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffBaseMs * 2 ** attempt);
          continue;
        }
        throw new AemetError(
          "NETWORK",
          `Fallo de red ${contexto} tras ${this.maxRetries + 1} intentos: ${(cause as Error).message}`,
        );
      }
    }
    // Solo se llega aquí si agotamos reintentos por 5xx.
    throw new AemetError(
      "UPSTREAM",
      `AEMET devolvió errores 5xx ${contexto} tras ${this.maxRetries + 1} intentos.`,
    );
  }

  /** Primer salto: obtiene y valida el sobre. Reintenta ante 429. */
  private async fetchEnvelope(path: string): Promise<AemetEnvelope> {
    const url = `${BASE_URL}${path}`;

    for (let attempt = 0; ; attempt++) {
      const res = await this.doFetch(
        url,
        { headers: { api_key: this.apiKey, Accept: "application/json" } },
        `llamando a AEMET (${path})`,
      );

      // AEMET responde el sobre con HTTP 200; pero 401/429 pueden llegar a
      // nivel HTTP. Intentamos leer el sobre y, si no hay, usamos el status HTTP.
      const envelope = await this.tryParseEnvelope(res);
      const estado = envelope?.estado ?? res.status;

      if (estado === 200 && envelope) return envelope;

      if (estado === 429) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffBaseMs * 2 ** attempt);
          continue;
        }
        throw this.errorForEstado(429, envelope?.descripcion);
      }

      throw this.errorForEstado(estado, envelope?.descripcion);
    }
  }

  private async tryParseEnvelope(res: Response): Promise<AemetEnvelope | null> {
    try {
      // El sobre JSON también viene en latin1: la `descripcion` lleva acentos
      // (p. ej. "límites"). Decodificar como UTF-8 los rompería.
      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder("latin1").decode(bytes);
      const data = JSON.parse(text) as Partial<AemetEnvelope>;
      if (typeof data?.estado === "number") return data as AemetEnvelope;
      return null;
    } catch {
      return null;
    }
  }

  private errorForEstado(estado: number, descripcion?: string): AemetError {
    const message = describeEstado(estado, descripcion);
    switch (estado) {
      case 401:
        return new AemetError("UNAUTHORIZED", message, 401);
      case 404:
        return new AemetError("NOT_FOUND", message, 404);
      case 429:
        return new AemetError("RATE_LIMITED", message, 429);
      default:
        return new AemetError("UPSTREAM", message, estado);
    }
  }

  /** Segundo salto: descarga el fichero de `datos` como bytes. */
  private async fetchBytes(datosUrl: string): Promise<Uint8Array> {
    const res = await this.doFetch(
      datosUrl,
      { headers: { api_key: this.apiKey } },
      "descargando el fichero de datos de AEMET",
      true, // reintentar 5xx transitorios del servidor de datos
    );
    if (!res.ok) {
      throw new AemetError(
        "UPSTREAM",
        `AEMET devolvió HTTP ${res.status} al descargar el fichero de datos.`,
        res.status,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
