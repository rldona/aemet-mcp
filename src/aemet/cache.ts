// Caché en memoria con TTL. Un Map con timestamp basta: el proceso es un único
// servidor stdio de vida corta y no queremos dependencias.

interface Entry<V> {
  value: V;
  /** epoch ms en que la entrada deja de ser válida. */
  expiresAt: number;
}

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();

  /**
   * Cargas en vuelo, por clave.
   *
   * Sin esto, N llamadas simultáneas a la misma clave lanzaban N cargas: la
   * caché solo se consultaba al principio y se escribía al final, así que
   * ninguna veía a las otras. En el servidor MCP por stdio da igual, porque las
   * llamadas llegan en serie, pero el mismo núcleo se usa como librería desde
   * backends con concurrencia real, donde eso multiplica el consumo de cuota
   * de AEMET por el número de peticiones que coincidan.
   */
  private readonly enCurso = new Map<string, Promise<V>>();

  /**
   * @param defaultTtlMs TTL por defecto en milisegundos.
   * @param now Inyectable para tests (por defecto Date.now).
   * @param onAcceso Observador opcional de aciertos/fallos. Se usa para las
   *   métricas de diagnóstico sin que la caché dependa del logger.
   */
  constructor(
    private readonly defaultTtlMs: number,
    private readonly now: () => number = Date.now,
    private readonly onAcceso?: (
      evento: "hit" | "miss" | "compartida",
      key: string,
    ) => void,
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /**
   * Devuelve el valor cacheado o ejecuta `factory`, cachea su resultado y lo
   * devuelve.
   *
   * Las llamadas simultáneas con la misma clave comparten una única promesa: la
   * segunda espera a la primera en vez de lanzar otra petición.
   *
   * Los errores NO se cachean: se propagan a todos los que esperaban y la carga
   * en vuelo se retira, así que el siguiente intento vuelve a probar. Cachear el
   * fallo dejaría el TTL entero devolviendo un error por un corte de red de un
   * segundo.
   */
  async getOrLoad(
    key: string,
    factory: () => Promise<V>,
    ttlMs: number = this.defaultTtlMs,
  ): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) {
      this.onAcceso?.("hit", key);
      return cached;
    }

    const enVuelo = this.enCurso.get(key);
    if (enVuelo) {
      this.onAcceso?.("compartida", key);
      return enVuelo;
    }
    this.onAcceso?.("miss", key);

    const promesa = factory()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.enCurso.delete(key);
      });

    this.enCurso.set(key, promesa);
    return promesa;
  }

  /** Invalida una clave concreta, incluida su carga en vuelo. */
  invalidate(key: string): void {
    this.store.delete(key);
    this.enCurso.delete(key);
  }

  /** Elimina las entradas caducadas. La caché no crece sola si nadie la consulta. */
  purge(): number {
    const ahora = this.now();
    let eliminadas = 0;
    for (const [key, entry] of this.store) {
      if (ahora >= entry.expiresAt) {
        this.store.delete(key);
        eliminadas++;
      }
    }
    return eliminadas;
  }

  /** Cargas actualmente en vuelo. Diagnóstico. */
  get enVuelo(): number {
    return this.enCurso.size;
  }

  clear(): void {
    this.store.clear();
    this.enCurso.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
