import { describe, it, expect, vi } from "vitest";
import { TtlCache } from "../src/aemet/cache.js";

describe("TtlCache", () => {
  it("devuelve el valor dentro del TTL y lo expira después", () => {
    let now = 1000;
    const cache = new TtlCache<string>(100, () => now);
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
    now = 1099;
    expect(cache.get("k")).toBe("v");
    now = 1100;
    expect(cache.get("k")).toBeUndefined();
  });

  it("getOrLoad solo invoca la factory una vez mientras esté cacheado", async () => {
    let now = 0;
    const cache = new TtlCache<number>(100, () => now);
    const factory = vi.fn(async () => 42);
    expect(await cache.getOrLoad("k", factory)).toBe(42);
    expect(await cache.getOrLoad("k", factory)).toBe(42);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("no cachea errores de la factory", async () => {
    const cache = new TtlCache<number>(100, () => 0);
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(7);
    await expect(cache.getOrLoad("k", factory)).rejects.toThrow("boom");
    expect(await cache.getOrLoad("k", factory)).toBe(7);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Deduplicación de cargas simultáneas (ticket 22)
// ---------------------------------------------------------------------------

describe("TtlCache: cargas concurrentes", () => {
  it("N llamadas simultáneas a la misma clave hacen UNA sola carga", async () => {
    const cache = new TtlCache<string>(1000);
    let cargas = 0;
    const factory = async () => {
      cargas++;
      await new Promise((r) => setTimeout(r, 10));
      return "valor";
    };

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => cache.getOrLoad("k", factory)),
    );

    expect(cargas).toBe(1);
    expect(resultados).toEqual(["valor", "valor", "valor", "valor", "valor"]);
  });

  it("claves distintas no se comparten entre sí", async () => {
    const cache = new TtlCache<string>(1000);
    let cargas = 0;
    const factory = (v: string) => async () => {
      cargas++;
      return v;
    };

    const [a, b] = await Promise.all([
      cache.getOrLoad("a", factory("A")),
      cache.getOrLoad("b", factory("B")),
    ]);

    expect([a, b]).toEqual(["A", "B"]);
    expect(cargas).toBe(2);
  });

  it("un error se propaga a todos los que esperaban y no envenena la caché", async () => {
    const cache = new TtlCache<string>(1000);
    let intentos = 0;
    const factory = async () => {
      intentos++;
      if (intentos === 1) throw new Error("fallo transitorio");
      return "ok";
    };

    const fallos = await Promise.allSettled([
      cache.getOrLoad("k", factory),
      cache.getOrLoad("k", factory),
    ]);
    expect(fallos.every((r) => r.status === "rejected")).toBe(true);
    expect(intentos).toBe(1); // el fallo también se compartió

    // La carga en vuelo se retiró: el siguiente intento vuelve a probar.
    expect(cache.enVuelo).toBe(0);
    await expect(cache.getOrLoad("k", factory)).resolves.toBe("ok");
  });

  it("tras resolverse, la carga en vuelo se retira y el valor queda cacheado", async () => {
    const cache = new TtlCache<string>(1000);
    await cache.getOrLoad("k", async () => "v");
    expect(cache.enVuelo).toBe(0);
    expect(cache.get("k")).toBe("v");
  });
});

describe("TtlCache: mantenimiento", () => {
  it("invalidate borra la clave", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "v");
    cache.invalidate("k");
    expect(cache.get("k")).toBeUndefined();
  });

  it("purge elimina solo lo caducado", () => {
    let ahora = 0;
    const cache = new TtlCache<string>(100, () => ahora);
    cache.set("viejo", "v", 50);
    cache.set("nuevo", "v", 500);

    ahora = 100;
    expect(cache.purge()).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get("nuevo")).toBe("v");
  });
});
