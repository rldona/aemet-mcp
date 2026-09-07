import { AemetError, describeEstado } from "./errors.js";
import { TtlCache } from "./cache.js";
import type { AemetEnvelope } from "./types.js";
import { log as logPorDefecto, urlSegura, type Logger } from "./log.js";

const BASE_URL = "https://opendata.aemet.es/opendata/api";

/**
 * Hosts a los que es aceptable enviar la cabecera `api_key`.
 *
 * El segundo salto va a la URL que AEMET devuelve en el campo `datos`: es una
 * URL que nos dicta el servidor, no una que construyamos nosotros. Antes de
 * reenviar la key ahí se comprueba contra esta lista.
 */
export const AEMET_HOSTS = ["opendata.aemet.es", "www.aemet.es"] as const;

/** Tiempo máximo por intento (ms). */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Tope de bytes por descarga. El fichero mayor, el inventario, ronda 1 MB. */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** TTL por defecto (ms). */
export const TTL = {
  prediccion: 10 * 60_000, // ~10 min
  observacion: 5 * 60_000, // ~5 min
  inventario: 24 * 60 * 60_000, // 24 h: el inventario cambia rara vez
} as const;

export interface AemetClientOptions {
  apiKey: string;
  /** Inyectable para tests. Por defecto el fetch global. */
  fetchImpl?: typeof fetch;
  /**
   * Reintentos ante fallos transitorios. Por defecto 3. Es un presupuesto
   * GLOBAL por operación, compartido por los dos saltos: `maxRetries: 3`
   * significa como mucho 4 peticiones en total, no 4 por salto.
   */
  maxRetries?: number;
  /** Base del backoff exponencial en ms. Por defecto 500. */
  backoffBaseMs?: number;
  /** Inyectable para tests: espera de backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Timeout por intento en ms. Por defecto 15 s. */
  timeoutMs?: number;
  /** Tope de bytes por respuesta. Por defecto 32 MiB. */
  maxBytes?: number;
  /** Hosts autorizados para la URL de `datos`. Por defecto `AEMET_HOSTS`. */
  allowedHosts?: readonly string[];
  /** Inyectable para tests: aleatoriedad del jitter. Por defecto Math.random. */
  random?: () => number;
  /** Logger de diagnóstico. Por defecto el del proceso (stderr). */
  logger?: Logger;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Presupuesto de reintentos de una operación completa (los dos saltos).
 *
 * Compartirlo evita que los bucles anidados (reintentos HTTP dentro de
 * reintentos por `estado` 429) se multipliquen: con `maxRetries: 3` el peor
 * caso eran 16 peticiones, y con timeout de 15 s eso son minutos de bloqueo.
 */
interface Presupuesto {
  /** Reintentos que quedan. */
  restantes: number;
  /** Reintentos ya gastados: fija el exponente del backoff. */
  usados: number;
}

/** Respuesta ya leída: el cuerpo se consume dentro del intento con timeout. */
interface RespuestaCruda {
  status: number;
  ok: boolean;
  bytes: Uint8Array;
  headers?: Headers;
}

/** ¿El fallo viene de que saltó el `AbortSignal.timeout`? */
function esTimeout(cause: unknown): boolean {
  const name = (cause as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Lee una cabecera de forma defensiva (los mocks de test no traen `headers`). */
function cabecera(res: { headers?: Headers }, nombre: string): string | null {
  try {
    return res.headers?.get?.(nombre) ?? null;
  } catch {
    return null;
  }
}

/**
 * `Retry-After` en ms, o null. Admite las dos formas del RFC: segundos
 * ("120") y fecha HTTP ("Wed, 21 Oct 2026 07:28:00 GMT").
 */
function retryAfterMs(valor: string | null, ahora: number): number | null {
  if (!valor) return null;
  const segundos = Number(valor.trim());
  if (Number.isFinite(segundos) && segundos >= 0) return segundos * 1000;
  const fecha = Date.parse(valor);
  if (Number.isFinite(fecha)) return Math.max(0, fecha - ahora);
  return null;
}

/**
 * Repara texto doblemente codificado ("AndÃºjar" -> "Andújar").
 *
 * AEMET declara `charset=ISO-8859-15` sirviendo bytes UTF-8, y algunos fetch
 * intermedios (el fetch parcheado de Next, proxies) se creen la cabecera y
 * transcodifican: el texto llega con secuencias "Ã?" en lugar de acentos.
 * Detectamos ese patrón (Ã + byte de continuación, imposible en español real)
 * y deshacemos la transcodificación. Idempotente sobre texto sano.
 */
export function reparaMojibake(text: string): string {
  for (let pasada = 0; pasada < 2 && /\u00C3[\u0080-\u00BF]/.test(text); pasada++) {
    const bytes = new Uint8Array(text.length);
    let esLatin1 = true;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c > 0xff) {
        esLatin1 = false;
        break;
      }
      bytes[i] = c;
    }
    if (!esLatin1) break;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      break; // no era una doble codificación: se deja tal cual
    }
  }
  return text;
}

/**
 * Aplica reparaMojibake a cada cadena de una estructura JSON, recursivamente.
 * Cadena a cadena (y no sobre el documento entero) para que un carácter raro
 * en un campo no impida reparar el resto.
 */
export function reparaProfundo<T>(valor: T): T {
  if (typeof valor === "string") return reparaMojibake(valor) as T;
  if (Array.isArray(valor)) return valor.map((v) => reparaProfundo(v)) as T;
  if (valor && typeof valor === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) out[k] = reparaProfundo(v);
    return out as T;
  }
  return valor;
}

/**
 * Comprueba que una URL de `datos` es segura antes de enviarle la API key:
 * HTTPS y host de AEMET. Devuelve la URL normalizada.
 */
export function validarUrlDatos(
  raw: string,
  permitidos: readonly string[] = AEMET_HOSTS,
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AemetError(
      "UNSAFE_URL",
      `AEMET devolvió una URL de datos ilegible: ${raw.slice(0, 200)}`,
    );
  }
  if (url.protocol !== "https:") {
    throw new AemetError(
      "UNSAFE_URL",
      `AEMET devolvió una URL de datos no HTTPS (${url.protocol}//${url.host}); no se envía la API key.`,
    );
  }
  const host = url.hostname.toLowerCase();
  if (!permitidos.some((h) => host === h.toLowerCase())) {
    throw new AemetError(
      "UNSAFE_URL",
      `AEMET devolvió una URL de datos en un host no autorizado (${host}); no se envía la API key.`,
    );
  }
  return url.toString();
}

/**
 * Cliente de la API OpenData de AEMET.
 *
 * Encapsula el patrón de DOS PASOS de AEMET:
 *   1) GET al endpoint -> sobre JSON `{ estado, descripcion, datos, metadatos }`.
 *   2) GET a la URL de `datos` -> contenido real (habitualmente latin1).
 *
 * Mapea los códigos `estado` (200/401/404/429/otros) a `AemetError` tipados,
 * reintenta con backoff exponencial y jitter, respeta `Retry-After`, aplica
 * timeout por intento y no envía la API key fuera de los hosts de AEMET.
 */
export class AemetClient {
  private readonly apiKey: string;
  private readonly fetchOverride?: typeof fetch;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly allowedHosts: readonly string[];
  private readonly random: () => number;
  private readonly log: Logger;
  private readonly cache: TtlCache<unknown>;

  constructor(opts: AemetClientOptions) {
    if (!opts.apiKey) {
      throw new AemetError(
        "MISSING_API_KEY",
        "Falta la API key de AEMET. Define la variable de entorno AEMET_API_KEY.",
      );
    }
    this.apiKey = opts.apiKey;
    this.fetchOverride = opts.fetchImpl;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.allowedHosts = opts.allowedHosts ?? AEMET_HOSTS;
    this.random = opts.random ?? Math.random;
    this.log = opts.logger ?? logPorDefecto;
    this.cache = new TtlCache<unknown>(TTL.prediccion, Date.now, (evento, key) => {
      this.log.debug("cache", { evento, key });
    });
  }

  /**
   * Se resuelve en cada llamada (no en el constructor): Next parchea
   * globalThis.fetch por petición y capturarlo pronto ata una versión rancia.
   */
  private get fetchImpl(): typeof fetch {
    return this.fetchOverride ?? globalThis.fetch;
  }

  private nuevoPresupuesto(): Presupuesto {
    return { restantes: this.maxRetries, usados: 0 };
  }

  /** Consume un reintento si queda presupuesto. */
  private consumir(p: Presupuesto): boolean {
    if (p.restantes <= 0) return false;
    p.restantes--;
    p.usados++;
    return true;
  }

  /**
   * Espera antes del siguiente intento. Usa `Retry-After` si el servidor lo
   * indica; si no, backoff exponencial con jitter (la mitad fija, la mitad
   * aleatoria) para no sincronizar reintentos entre procesos.
   */
  private async esperar(p: Presupuesto, res?: RespuestaCruda): Promise<void> {
    const indicado = res ? retryAfterMs(cabecera(res, "retry-after"), Date.now()) : null;
    if (indicado !== null) {
      // Cota superior: un Retry-After largo no debe colgar el turno del agente.
      await this.sleep(Math.min(indicado, 30_000));
      return;
    }
    const base = this.backoffBaseMs * 2 ** (p.usados - 1);
    await this.sleep(base / 2 + this.random() * (base / 2));
  }

  /**
   * Ejecuta el patrón de dos pasos y devuelve el contenido de `datos` como texto
   * decodificado. AEMET mezcla codificaciones según el endpoint (el maestro va
   * en latin1, la predicción municipal en UTF-8…), así que se auto-detecta:
   * UTF-8 estricto y, si los bytes no son UTF-8 válido, latin1.
   */
  private async fetchDatosText(path: string): Promise<string> {
    const bytes = await this.fetchDatosBytes(path);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("latin1").decode(bytes);
    }
    return reparaMojibake(text);
  }

  /** Igual que fetchDatosText pero devuelve los bytes crudos (para tar.gz/CAP). */
  async fetchDatosBytes(path: string): Promise<Uint8Array> {
    const presupuesto = this.nuevoPresupuesto();
    const envelope = await this.fetchEnvelope(path, presupuesto);
    if (!envelope.datos) {
      throw new AemetError(
        "UPSTREAM",
        `AEMET devolvió estado 200 pero sin URL de datos para ${path}.`,
        envelope.estado,
      );
    }
    return this.fetchBytes(envelope.datos, presupuesto);
  }

  /**
   * Patrón de dos pasos + JSON. Decodifica latin1 y parsea. Cachea por `path`.
   */
  async fetchJson<T>(path: string, ttlMs?: number): Promise<T> {
    return this.cache.getOrLoad(
      `json:${path}`,
      async () => {
        const text = await this.fetchDatosText(path);
        try {
          // El servidor de datos de AEMET devuelve codificaciones distintas
          // según el nodo que responda: reparación también tras el parse.
          return reparaProfundo(JSON.parse(text)) as T;
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
   * Lee el cuerpo con tope de tamaño. Prefiere el stream (corta en cuanto se
   * pasa, sin materializar la respuesta entera); si no hay `body` legible
   * —mocks de test, runtimes viejos— cae a `arrayBuffer` y comprueba después.
   */
  private async leerBytes(res: Response, contexto: string): Promise<Uint8Array> {
    const declarado = Number(cabecera(res, "content-length"));
    if (Number.isFinite(declarado) && declarado > this.maxBytes) {
      throw this.errorDemasiadoGrande(declarado, contexto);
    }

    const body = res.body;
    if (!body || typeof body.getReader !== "function") {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > this.maxBytes) {
        throw this.errorDemasiadoGrande(buf.byteLength, contexto);
      }
      return buf;
    }

    const reader = body.getReader();
    const trozos: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > this.maxBytes) {
        await reader.cancel().catch(() => {});
        throw this.errorDemasiadoGrande(total, contexto);
      }
      trozos.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const t of trozos) {
      out.set(t, offset);
      offset += t.byteLength;
    }
    return out;
  }

  private errorDemasiadoGrande(bytes: number, contexto: string): AemetError {
    const mib = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
    return new AemetError(
      "TOO_LARGE",
      `La respuesta de AEMET ${contexto} supera el máximo aceptado ` +
        `(${mib(bytes)} > ${mib(this.maxBytes)}).`,
    );
  }

  /**
   * Un intento HTTP con timeout, más reintentos ante fallos transitorios
   * (timeout, corte de red y 5xx, que en el servidor de datos de AEMET son
   * habituales). El cuerpo se lee aquí dentro para que quede cubierto por el
   * mismo timeout que la cabecera. No sigue redirecciones: reenviar la API key
   * a donde apunte un `Location` es justo lo que se quiere evitar.
   */
  private async doFetch(
    url: string,
    init: RequestInit,
    contexto: string,
    presupuesto: Presupuesto,
  ): Promise<RespuestaCruda> {
    for (;;) {
      const inicio = Date.now();
      try {
        const res = await this.fetchImpl(url, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        this.log.debug("http", {
          url: urlSegura(url),
          status: res.status,
          ms: Date.now() - inicio,
          intento: presupuesto.usados,
        });

        if (res.status >= 300 && res.status < 400) {
          const destino = cabecera(res, "location") ?? "(sin Location)";
          throw new AemetError(
            "UNSAFE_URL",
            `AEMET respondió con una redirección ${contexto} hacia ${destino}; ` +
              "no se sigue para no reenviar la API key.",
            res.status,
          );
        }

        if (res.status >= 500) {
          const cruda: RespuestaCruda = {
            status: res.status,
            ok: false,
            bytes: new Uint8Array(0),
            headers: res.headers,
          };
          if (this.consumir(presupuesto)) {
            this.log.warn("reintento por 5xx", {
              url: urlSegura(url),
              status: res.status,
              intento: presupuesto.usados,
            });
            await this.esperar(presupuesto, cruda);
            continue;
          }
          throw new AemetError(
            "UPSTREAM",
            `AEMET devolvió HTTP ${res.status} ${contexto} tras agotar los reintentos.`,
            res.status,
          );
        }

        return {
          status: res.status,
          ok: res.ok,
          bytes: await this.leerBytes(res, contexto),
          headers: res.headers,
        };
      } catch (cause) {
        // Los errores propios (redirección, tamaño) son permanentes: no se reintentan.
        if (cause instanceof AemetError) throw cause;

        const porTimeout = esTimeout(cause);
        if (this.consumir(presupuesto)) {
          this.log.warn(porTimeout ? "reintento por timeout" : "reintento por red", {
            url: urlSegura(url),
            ms: Date.now() - inicio,
            intento: presupuesto.usados,
          });
          await this.esperar(presupuesto);
          continue;
        }
        this.log.error(porTimeout ? "timeout definitivo" : "fallo de red definitivo", {
          url: urlSegura(url),
          intentos: presupuesto.usados + 1,
        });
        const intentos = presupuesto.usados + 1;
        if (porTimeout) {
          throw new AemetError(
            "TIMEOUT",
            `AEMET no respondió ${contexto} en ${this.timeoutMs} ms (${intentos} intentos).`,
          );
        }
        throw new AemetError(
          "NETWORK",
          `Fallo de red ${contexto} tras ${intentos} intentos: ${(cause as Error).message}`,
        );
      }
    }
  }

  /** Primer salto: obtiene y valida el sobre. Reintenta ante `estado` 429. */
  private async fetchEnvelope(
    path: string,
    presupuesto: Presupuesto,
  ): Promise<AemetEnvelope> {
    const url = `${BASE_URL}${path}`;
    const contexto = `llamando a AEMET (${path})`;

    for (;;) {
      const res = await this.doFetch(
        url,
        { headers: { api_key: this.apiKey, Accept: "application/json" } },
        contexto,
        presupuesto,
      );

      // AEMET responde el sobre con HTTP 200; pero 401/429 pueden llegar a
      // nivel HTTP. Intentamos leer el sobre y, si no hay, usamos el status HTTP.
      const envelope = this.parseEnvelope(res.bytes);
      const estado = envelope?.estado ?? res.status;

      if (estado === 200 && envelope) return envelope;

      if (estado === 429) {
        if (this.consumir(presupuesto)) {
          this.log.warn("reintento por 429", { path, intento: presupuesto.usados });
          await this.esperar(presupuesto, res);
          continue;
        }
        throw this.errorForEstado(429, envelope?.descripcion);
      }

      throw this.errorForEstado(estado, envelope?.descripcion);
    }
  }

  private parseEnvelope(bytes: Uint8Array): AemetEnvelope | null {
    try {
      // El sobre JSON también viene en latin1: la `descripcion` lleva acentos
      // (p. ej. "límites"). Decodificar como UTF-8 los rompería.
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
  private async fetchBytes(
    datosUrl: string,
    presupuesto: Presupuesto,
  ): Promise<Uint8Array> {
    // La URL la dicta AEMET: se valida ANTES de adjuntar la API key.
    const url = validarUrlDatos(datosUrl, this.allowedHosts);
    const res = await this.doFetch(
      url,
      { headers: { api_key: this.apiKey } },
      "descargando el fichero de datos de AEMET",
      presupuesto,
    );
    if (!res.ok) {
      throw new AemetError(
        "UPSTREAM",
        `AEMET devolvió HTTP ${res.status} al descargar el fichero de datos.`,
        res.status,
      );
    }
    return res.bytes;
  }
}
