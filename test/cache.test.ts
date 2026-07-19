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
