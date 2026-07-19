import { describe, it, expect, vi } from "vitest";
import { AemetClient } from "../src/aemet/client.js";
import { AemetError } from "../src/aemet/errors.js";

/** Respuesta tipo `Response` mínima para el sobre JSON del primer salto. */
function envelopeResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

/** Respuesta binaria para el segundo salto (fichero de `datos`). */
function bytesResponse(bytes: Uint8Array, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => {
      throw new Error("no json");
    },
  } as unknown as Response;
}

const DATOS_URL = "https://opendata.aemet.es/opendata/sh/xyz";

describe("AemetClient.fetchJson (patrón de dos pasos)", () => {
  it("hace los dos saltos y parsea el JSON del segundo", async () => {
    const payload = [{ nombre: "Madrid", temp: 30 }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "exito", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(
        bytesResponse(new TextEncoder().encode(JSON.stringify(payload))),
      );

    const client = new AemetClient({ apiKey: "K", fetchImpl });
    const result = await client.fetchJson<typeof payload>("/x");

    expect(result).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Primer salto: cabecera api_key.
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ api_key: "K" });
    // Segundo salto: a la URL de `datos`.
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(DATOS_URL);
  });

  it("decodifica el fichero de datos como latin1 (acentos correctos)", async () => {
    // "Lidón" y "Cañada" en ISO-8859-1.
    const latin1 = new Uint8Array([
      0x7b, 0x22, 0x6e, 0x22, 0x3a, 0x22, 0x4c, 0x69, 0x64, 0xf3, 0x6e, 0x20,
      0x43, 0x61, 0xf1, 0x61, 0x64, 0x61, 0x22, 0x7d,
    ]); // {"n":"Lidón Cañada"}
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "exito", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(latin1));

    const client = new AemetClient({ apiKey: "K", fetchImpl });
    const result = await client.fetchJson<{ n: string }>("/x");
    expect(result.n).toBe("Lidón Cañada");
  });

  it("cachea: dos llamadas al mismo path solo hacen una ronda de fetch", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("[]")));

    const client = new AemetClient({ apiKey: "K", fetchImpl });
    await client.fetchJson("/x");
    await client.fetchJson("/x");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no 4
  });
});

describe("AemetClient mapeo de estado", () => {
  const cases: Array<[number, string]> = [
    [401, "UNAUTHORIZED"],
    [404, "NOT_FOUND"],
    [500, "UPSTREAM"],
  ];

  for (const [estado, code] of cases) {
    it(`estado ${estado} -> AemetError ${code}`, async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          envelopeResponse({ estado, descripcion: "err" }, estado === 500 ? 200 : estado),
        );
      const client = new AemetClient({ apiKey: "K", fetchImpl });
      await expect(client.fetchJson("/x")).rejects.toMatchObject({
        name: "AemetError",
        code,
      });
    });
  }

  it("lanza MISSING_API_KEY si no hay key", () => {
    expect(() => new AemetClient({ apiKey: "" })).toThrow(AemetError);
  });
});

describe("AemetClient reintentos ante 429", () => {
  it("reintenta con backoff y acaba resolviendo", async () => {
    const payload = [{ ok: true }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(envelopeResponse({ estado: 429, descripcion: "slow down" }))
      .mockResolvedValueOnce(envelopeResponse({ estado: 429, descripcion: "slow down" }))
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(
        bytesResponse(new TextEncoder().encode(JSON.stringify(payload))),
      );

    const sleep = vi.fn(async () => {});
    const client = new AemetClient({
      apiKey: "K",
      fetchImpl,
      maxRetries: 3,
      sleep,
    });
    const result = await client.fetchJson<typeof payload>("/x");
    expect(result).toEqual(payload);
    expect(sleep).toHaveBeenCalledTimes(2); // dos reintentos antes del éxito
  });

  it("agota reintentos y lanza RATE_LIMITED", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(envelopeResponse({ estado: 429, descripcion: "slow down" }));
    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, maxRetries: 2, sleep });
    await expect(client.fetchJson("/x")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // 1 intento inicial + 2 reintentos = 3 llamadas al primer salto.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
