import { describe, it, expect, vi } from "vitest";
import { crearLogger, nivelDesdeEntorno, urlSegura } from "../src/aemet/log.js";
import { AemetClient } from "../src/aemet/client.js";

describe("nivelDesdeEntorno", () => {
  it("lee el nivel de la variable de entorno", () => {
    expect(nivelDesdeEntorno("debug")).toBe("debug");
    expect(nivelDesdeEntorno("  ERROR ")).toBe("error");
  });

  it("un valor desconocido o ausente cae al nivel por defecto", () => {
    expect(nivelDesdeEntorno(undefined)).toBe("warn");
    expect(nivelDesdeEntorno("chatarra")).toBe("warn");
    expect(nivelDesdeEntorno("", "info")).toBe("info");
  });
});

describe("urlSegura", () => {
  it("borra la query, que es donde podría viajar un token", () => {
    expect(urlSegura("https://opendata.aemet.es/opendata/sh/abc?api_key=SECRETA")).toBe(
      "https://opendata.aemet.es/opendata/sh/abc",
    );
  });

  it("recorta lo que no puede parsear en vez de volcarlo entero", () => {
    const basura = "x".repeat(500);
    expect(urlSegura(basura).length).toBeLessThanOrEqual(120);
  });
});

describe("crearLogger", () => {
  it("respeta el umbral de nivel", () => {
    const lineas: string[] = [];
    const log = crearLogger("warn", (l) => lineas.push(l));

    log.error("un error");
    log.warn("un aviso");
    log.info("no debería salir");
    log.debug("tampoco");

    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain("error un error");
    expect(lineas[1]).toContain("warn un aviso");
  });

  it("silent no emite nada", () => {
    const lineas: string[] = [];
    const log = crearLogger("silent", (l) => lineas.push(l));
    log.error("ni esto");
    expect(lineas).toEqual([]);
  });

  it("formatea los campos como clave=valor y omite los undefined", () => {
    const lineas: string[] = [];
    const log = crearLogger("debug", (l) => lineas.push(l));
    log.debug("http", { status: 200, ms: 12, nada: undefined });
    expect(lineas[0]).toBe("[aemet-mcp] debug http status=200 ms=12");
  });

  it("habilitado permite evitar cálculos caros", () => {
    const log = crearLogger("warn", () => {});
    expect(log.habilitado("warn")).toBe(true);
    expect(log.habilitado("debug")).toBe(false);
  });
});

describe("instrumentación del cliente", () => {
  function envelope(body: unknown): Response {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    return {
      status: 200,
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response;
  }

  const DATOS = "https://opendata.aemet.es/opendata/sh/xyz";

  it("registra los reintentos como aviso", async () => {
    const lineas: string[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(envelope({ estado: 429, descripcion: "slow" }))
      .mockResolvedValueOnce(envelope({ estado: 200, descripcion: "ok", datos: DATOS }))
      .mockResolvedValueOnce(envelope([]));

    const client = new AemetClient({
      apiKey: "SECRETA",
      fetchImpl,
      sleep: async () => {},
      logger: crearLogger("warn", (l) => lineas.push(l)),
    });
    await client.fetchJson("/x");

    expect(lineas.some((l) => l.includes("reintento por 429"))).toBe(true);
  });

  it("nunca escribe la API key en el log", async () => {
    const lineas: string[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        envelope({ estado: 200, descripcion: "ok", datos: `${DATOS}?api_key=SECRETA` }),
      )
      .mockResolvedValueOnce(envelope([]));

    const client = new AemetClient({
      apiKey: "SECRETA",
      fetchImpl,
      logger: crearLogger("debug", (l) => lineas.push(l)),
    });
    await client.fetchJson("/x");

    expect(lineas.length).toBeGreaterThan(0);
    for (const linea of lineas) {
      expect(linea).not.toContain("SECRETA");
    }
  });

  it("en debug informa de los aciertos de caché", async () => {
    const lineas: string[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(envelope({ estado: 200, descripcion: "ok", datos: DATOS }))
      .mockResolvedValueOnce(envelope([]));

    const client = new AemetClient({
      apiKey: "K",
      fetchImpl,
      logger: crearLogger("debug", (l) => lineas.push(l)),
    });
    await client.fetchJson("/x");
    await client.fetchJson("/x");

    expect(lineas.some((l) => l.includes("cache evento=miss"))).toBe(true);
    expect(lineas.some((l) => l.includes("cache evento=hit"))).toBe(true);
  });
});
