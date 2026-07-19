import { describe, it, expect, vi } from "vitest";
import { AemetClient, validarUrlDatos } from "../src/aemet/client.js";
import { AemetError } from "../src/aemet/errors.js";

/**
 * Respuesta tipo `Response` para el sobre del primer salto. El sobre viene en
 * latin1 (igual que los datos), así que lo codificamos como tal.
 */
function envelopeResponse(body: unknown, status = 200): Response {
  const bytes = latin1Bytes(JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

/** Codifica un string ASCII/latin1 a bytes (1 byte por code point < 256). */
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
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

  it("decodifica la descripción del sobre en latin1 (acentos en errores)", async () => {
    // "límites" en latin1 dentro del sobre de error.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 404, descripcion: "sin datos: límites" }, 404),
      );
    const client = new AemetClient({ apiKey: "K", fetchImpl });
    await expect(client.fetchJson("/x")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("límites"),
    });
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

  it("reintenta fallos de red transitorios en el segundo salto", async () => {
    const payload = [{ ok: true }];
    const fetchImpl = vi
      .fn()
      // primer salto: sobre OK
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      // segundo salto: primer intento falla (red), segundo va bien
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        bytesResponse(new TextEncoder().encode(JSON.stringify(payload))),
      );
    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, maxRetries: 3, sleep });
    const result = await client.fetchJson<typeof payload>("/x");
    expect(result).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // sobre + 2 intentos de datos
  });

  it("agota reintentos de red y lanza NETWORK", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockRejectedValue(new TypeError("fetch failed"));
    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, maxRetries: 2, sleep });
    await expect(client.fetchJson("/x")).rejects.toMatchObject({ code: "NETWORK" });
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


// ---------------------------------------------------------------------------
// Timeout (ticket 1)
// ---------------------------------------------------------------------------

/** Error equivalente al que lanza `fetch` cuando salta `AbortSignal.timeout`. */
function timeoutError(): Error {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

describe("AemetClient timeout", () => {
  it("pasa un AbortSignal a fetch en cada intento", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("[]")));

    const client = new AemetClient({ apiKey: "K", fetchImpl, timeoutMs: 1234 });
    await client.fetchJson("/x");

    for (const call of fetchImpl.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("reintenta el timeout y acaba lanzando TIMEOUT", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(timeoutError());
    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, maxRetries: 2, sleep });

    await expect(client.fetchJson("/x")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 intento + 2 reintentos
  });

  it("un timeout aislado se reintenta y la operación se completa", async () => {
    const payload = [{ ok: true }];
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(
        bytesResponse(new TextEncoder().encode(JSON.stringify(payload))),
      );
    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, maxRetries: 3, sleep });

    await expect(client.fetchJson("/x")).resolves.toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// URL de datos: la API key no sale de los hosts de AEMET (ticket 2)
// ---------------------------------------------------------------------------

describe("validarUrlDatos", () => {
  it("acepta los hosts de AEMET por HTTPS", () => {
    expect(validarUrlDatos("https://opendata.aemet.es/opendata/sh/x")).toContain(
      "opendata.aemet.es",
    );
    expect(() => validarUrlDatos("https://www.aemet.es/x")).not.toThrow();
  });

  const rechazadas = [
    ["host ajeno", "https://evil.example.com/x"],
    ["sufijo que imita el host", "https://opendata.aemet.es.evil.com/x"],
    ["sin TLS", "http://opendata.aemet.es/x"],
    ["otro esquema", "file:///etc/passwd"],
    ["URL ilegible", "no-es-una-url"],
  ] as const;

  for (const [caso, url] of rechazadas) {
    it(`rechaza ${caso}`, () => {
      expect(() => validarUrlDatos(url)).toThrowError(
        expect.objectContaining({ code: "UNSAFE_URL" }),
      );
    });
  }

  it("respeta una lista de hosts propia", () => {
    expect(() =>
      validarUrlDatos("https://mirror.interno/x", ["mirror.interno"]),
    ).not.toThrow();
  });
});

describe("AemetClient segundo salto", () => {
  it("no envía la API key si AEMET apunta fuera de sus hosts", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      envelopeResponse({
        estado: 200,
        descripcion: "ok",
        datos: "https://evil.example.com/roba-la-key",
      }),
    );
    const client = new AemetClient({ apiKey: "SECRETA", fetchImpl });

    await expect(client.fetchJson("/x")).rejects.toMatchObject({
      code: "UNSAFE_URL",
    });
    // Solo el primer salto: la key nunca viaja al host no autorizado.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("opendata.aemet.es");
  });

  it("no sigue redirecciones en el salto de datos", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(new Uint8Array(0), 302));
    const client = new AemetClient({ apiKey: "K", fetchImpl });

    await expect(client.fetchJson("/x")).rejects.toMatchObject({
      code: "UNSAFE_URL",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no hay tercer salto
    expect(fetchImpl.mock.calls[1]?.[1]?.redirect).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// Tope de tamaño (ticket 3)
// ---------------------------------------------------------------------------

describe("AemetClient tope de tamaño", () => {
  it("rechaza un cuerpo mayor que maxBytes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(new Uint8Array(5000)));
    const client = new AemetClient({ apiKey: "K", fetchImpl, maxBytes: 1000 });

    await expect(client.fetchJson("/x")).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
  });

  it("rechaza por Content-Length antes de leer el cuerpo", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const enorme = {
      status: 200,
      ok: true,
      headers: new Headers({ "content-length": "999999999" }),
      arrayBuffer,
    } as unknown as Response;

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(enorme);
    const client = new AemetClient({ apiKey: "K", fetchImpl, maxBytes: 1000 });

    await expect(client.fetchJson("/x")).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("no reintenta un TOO_LARGE: es un fallo permanente", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValue(bytesResponse(new Uint8Array(5000)));
    const sleep = vi.fn(async () => {});
    const client = new AemetClient({
      apiKey: "K",
      fetchImpl,
      maxBytes: 10,
      maxRetries: 3,
      sleep,
    });

    await expect(client.fetchJson("/x")).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(sleep).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reintentos: Retry-After, jitter y presupuesto compartido (ticket 4)
// ---------------------------------------------------------------------------

/** Igual que envelopeResponse pero con cabeceras. */
function envelopeConCabeceras(body: unknown, headers: Record<string, string>): Response {
  const base = envelopeResponse(body);
  return { ...base, headers: new Headers(headers) } as unknown as Response;
}

describe("AemetClient reintentos", () => {
  it("respeta Retry-After en segundos ante un 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeConCabeceras({ estado: 429, descripcion: "slow down" }, {
          "retry-after": "2",
        }),
      )
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("[]")));

    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, sleep });
    await client.fetchJson("/x");

    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("acota un Retry-After desmedido a 30 s", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelopeConCabeceras({ estado: 429, descripcion: "slow down" }, {
          "retry-after": "86400",
        }),
      )
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("[]")));

    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, sleep });
    await client.fetchJson("/x");

    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it("aplica jitter al backoff: mitad fija, mitad aleatoria", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(envelopeResponse({ estado: 429, descripcion: "x" }))
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("[]")));

    const sleep = vi.fn(async () => {});
    const client = new AemetClient({
      apiKey: "K",
      fetchImpl,
      sleep,
      backoffBaseMs: 400,
      random: () => 1, // jitter máximo
    });
    await client.fetchJson("/x");

    // base 400 -> 200 fijos + 200 * random
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it("reintenta 5xx HTTP también en el primer salto", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(bytesResponse(new Uint8Array(0), 503))
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("[]")));

    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, sleep });
    await expect(client.fetchJson("/x")).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("el presupuesto de reintentos es global a la operación, no por salto", async () => {
    const fetchImpl = vi
      .fn()
      // salto 1: un 429 que consume presupuesto
      .mockResolvedValueOnce(envelopeResponse({ estado: 429, descripcion: "x" }))
      .mockResolvedValueOnce(
        envelopeResponse({ estado: 200, descripcion: "ok", datos: DATOS_URL }),
      )
      // salto 2: falla siempre
      .mockRejectedValue(new TypeError("fetch failed"));

    const sleep = vi.fn(async () => {});
    const client = new AemetClient({ apiKey: "K", fetchImpl, maxRetries: 2, sleep });

    await expect(client.fetchJson("/x")).rejects.toMatchObject({ code: "NETWORK" });
    // 2 saltos + 2 reintentos en total. Sin presupuesto compartido serían 6.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
