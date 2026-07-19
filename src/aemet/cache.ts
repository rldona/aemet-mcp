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
   * @param defaultTtlMs TTL por defecto en milisegundos.
   * @param now Inyectable para tests (por defecto Date.now).
   */
  constructor(
    private readonly defaultTtlMs: number,
    private readonly now: () => number = Date.now,
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
   * devuelve. Los errores NO se cachean (se propagan sin envenenar la caché).
   */
  async getOrLoad(
    key: string,
    factory: () => Promise<V>,
    ttlMs: number = this.defaultTtlMs,
  ): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
