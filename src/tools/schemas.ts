// Salidas estructuradas de las herramientas MCP.
//
// Cada tool devuelve dos cosas: el texto de siempre (`content`), pensado para
// que el modelo lo lea, y `structuredContent`, tipado por `outputSchema`, para
// que un agente pueda consumir los valores sin parsear prosa. El texto se
// mantiene tal cual por compatibilidad: los clientes que ya funcionaban siguen
// viendo lo mismo.
//
// Convención: lo que AEMET no da es `null`, nunca ausente ni cadena vacía. Un
// campo que falta obliga a distinguir "no vino" de "vino vacío"; un null dice
// "no hay dato" y punto. Las unidades van en el `.describe()` de cada campo,
// que es lo que acaba viendo el agente.

import { z } from "zod";
import type { Municipio, Observacion, PrediccionDiariaMunicipio, PrediccionHorariaMunicipio } from "../aemet/types.js";
import type { Aviso, NivelAviso, ResultadoAvisos } from "../aemet/avisos.js";
import { pickPeriodo, probPrecipitacionDia } from "../aemet/format.js";
import type { EstacionResuelta } from "../aemet/estaciones.js";

/** AEMET mezcla números y cadenas (y manda "" cuando no hay dato). */
function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

export const municipioSchema = z.object({
  codigo: z.string().describe("Código INE de 5 dígitos"),
  nombre: z.string().describe("Nombre en forma natural, p. ej. 'el Campello'"),
  nombreINE: z.string().describe("Nombre del nomenclátor del INE, p. ej. 'Campello, el'"),
  provincia: z.string(),
});

export function aMunicipio(m: Municipio): z.infer<typeof municipioSchema> {
  return {
    codigo: m.codigo,
    nombre: m.nombreNatural,
    nombreINE: m.nombre,
    provincia: m.provincia,
  };
}

// ---------------------------------------------------------------------------
// buscar_municipio
// ---------------------------------------------------------------------------

export const salidaBuscarMunicipio = {
  consulta: z.string().describe("Texto buscado"),
  total: z.number().int().describe("Municipios devueltos (acotado por el límite)"),
  municipios: z.array(municipioSchema),
};

export function aSalidaBuscarMunicipio(consulta: string, resultados: Municipio[]) {
  return {
    consulta,
    total: resultados.length,
    municipios: resultados.map(aMunicipio),
  };
}

// ---------------------------------------------------------------------------
// prediccion_diaria
// ---------------------------------------------------------------------------

const diaDiariaSchema = z.object({
  fecha: z.string().describe("Fecha ISO YYYY-MM-DD"),
  temperaturaMaxima: z.number().nullable().describe("°C"),
  temperaturaMinima: z.number().nullable().describe("°C"),
  cielo: z.string().nullable().describe("Estado del cielo del día completo"),
  probabilidadPrecipitacion: z.number().nullable().describe("% para el día completo"),
  viento: z.object({
    direccion: z.string().nullable().describe("Rosa de los vientos, p. ej. 'NE'"),
    velocidad: z.number().nullable().describe("km/h"),
    rachaMaxima: z.number().nullable().describe("km/h"),
  }),
  humedadRelativa: z.object({
    maxima: z.number().nullable().describe("%"),
    minima: z.number().nullable().describe("%"),
  }),
});

export const salidaPrediccionDiaria = {
  municipio: municipioSchema,
  elaborado: z.string().nullable().describe("Momento de elaboración según AEMET"),
  dias: z.array(diaDiariaSchema),
};

export function aSalidaPrediccionDiaria(
  m: Municipio,
  pred: PrediccionDiariaMunicipio,
  maxDias: number,
) {
  const dias = (pred.prediccion?.dia ?? []).slice(0, maxDias).map((dia) => {
    const viento = pickPeriodo(dia.viento);
    return {
      fecha: dia.fecha.slice(0, 10),
      temperaturaMaxima: num(dia.temperatura?.maxima),
      temperaturaMinima: num(dia.temperatura?.minima),
      cielo: str(pickPeriodo(dia.estadoCielo)?.descripcion),
      probabilidadPrecipitacion: num(probPrecipitacionDia(dia.probPrecipitacion)),
      viento: {
        direccion: str(viento?.direccion),
        velocidad: num(viento?.velocidad),
        rachaMaxima: num(pickPeriodo(dia.rachaMax)?.value),
      },
      humedadRelativa: {
        maxima: num(dia.humedadRelativa?.maxima),
        minima: num(dia.humedadRelativa?.minima),
      },
    };
  });

  return { municipio: aMunicipio(m), elaborado: str(pred.elaborado), dias };
}

// ---------------------------------------------------------------------------
// prediccion_horaria
// ---------------------------------------------------------------------------

const horaSchema = z.object({
  hora: z.string().describe("Hora local en formato 'HH'"),
  temperatura: z.number().nullable().describe("°C"),
  cielo: z.string().nullable(),
  precipitacion: z.number().nullable().describe("mm en esa hora"),
  viento: z.object({
    direccion: z.string().nullable(),
    velocidad: z.number().nullable().describe("km/h"),
  }),
});

export const salidaPrediccionHoraria = {
  municipio: municipioSchema,
  elaborado: z.string().nullable(),
  dias: z.array(
    z.object({
      fecha: z.string().describe("Fecha ISO YYYY-MM-DD"),
      horas: z.array(horaSchema),
    }),
  ),
};

export function aSalidaPrediccionHoraria(
  m: Municipio,
  pred: PrediccionHorariaMunicipio,
  maxDias: number,
) {
  const dias = (pred.prediccion?.dia ?? []).slice(0, maxDias).map((dia) => {
    const cielo = new Map((dia.estadoCielo ?? []).map((x) => [x.periodo, x]));
    const precip = new Map((dia.precipitacion ?? []).map((x) => [x.periodo, x]));
    const viento = new Map(
      (dia.vientoAndRachaMax ?? [])
        .filter((v) => Array.isArray(v.direccion) && Array.isArray(v.velocidad))
        .map((v) => [v.periodo, v]),
    );

    const horas = (dia.temperatura ?? []).map((t) => {
      const h = t.periodo ?? "";
      const v = viento.get(h);
      return {
        hora: h.padStart(2, "0"),
        temperatura: num(t.value),
        cielo: str(cielo.get(h)?.descripcion),
        precipitacion: num(precip.get(h)?.value),
        viento: {
          direccion: str(v?.direccion?.[0]),
          velocidad: num(v?.velocidad?.[0]),
        },
      };
    });

    return { fecha: dia.fecha.slice(0, 10), horas };
  });

  return { municipio: aMunicipio(m), elaborado: str(pred.elaborado), dias };
}

// ---------------------------------------------------------------------------
// observacion
// ---------------------------------------------------------------------------

export const estacionSchema = z.object({
  idema: z.string().describe("Identificador de estación de AEMET"),
  nombre: z.string(),
  provincia: z.string().nullable(),
});

export const salidaObservacion = {
  estacion: estacionSchema,
  fecha: z.string().nullable().describe("Momento del dato (UTC, ISO)"),
  temperatura: z.number().nullable().describe("°C"),
  humedadRelativa: z.number().nullable().describe("%"),
  precipitacion: z.number().nullable().describe("mm en la última hora"),
  viento: z.object({
    velocidad: z.number().nullable().describe("m/s"),
    direccion: z.number().nullable().describe("grados"),
  }),
  presion: z.number().nullable().describe("hPa"),
};

export function aSalidaObservacion(o: Observacion, estacion?: EstacionResuelta) {
  return {
    estacion: {
      idema: o.idema,
      nombre: estacion?.nombre ?? o.ubi ?? o.idema,
      provincia: str(estacion?.provincia),
    },
    fecha: str(o.fint),
    temperatura: num(o.ta),
    humedadRelativa: num(o.hr),
    precipitacion: num(o.prec),
    viento: { velocidad: num(o.vv), direccion: num(o.dv) },
    presion: num(o.pres),
  };
}

// ---------------------------------------------------------------------------
// avisos
// ---------------------------------------------------------------------------

const NIVELES = ["amarillo", "naranja", "rojo"] as const;

const avisoSchema = z.object({
  nivel: z.enum(NIVELES),
  fenomeno: z.string().describe("p. ej. 'Temperaturas máximas'"),
  zona: z.string().describe("Zona de aviso de AEMET"),
  inicio: z.string().nullable().describe("ISO con offset"),
  fin: z.string().nullable().describe("ISO con offset"),
  descripcion: z.string().nullable(),
  probabilidad: z.string().nullable().describe("Rango, p. ej. '40%-70%'"),
});

export const salidaAvisos = {
  area: z.object({
    codigo: z.string().describe("Código de área CAP de AEMET"),
    nombre: z.string().describe("Comunidad autónoma"),
  }),
  elaborado: z.string().nullable(),
  total: z.number().int(),
  nivelMaximo: z.enum(NIVELES).nullable().describe("null si no hay avisos"),
  porNivel: z.object({
    rojo: z.number().int(),
    naranja: z.number().int(),
    amarillo: z.number().int(),
  }),
  avisos: z.array(avisoSchema),
};

export function aSalidaAvisos(
  area: { codigo: string; nombre: string },
  resultado: ResultadoAvisos,
) {
  const porNivel: Record<NivelAviso, number> = { rojo: 0, naranja: 0, amarillo: 0 };
  for (const a of resultado.avisos) porNivel[a.nivel]++;

  const nivelMaximo =
    (["rojo", "naranja", "amarillo"] as const).find((n) => porNivel[n] > 0) ?? null;

  return {
    area: { codigo: area.codigo, nombre: area.nombre },
    elaborado: str(resultado.elaborado),
    total: resultado.avisos.length,
    nivelMaximo,
    porNivel,
    avisos: resultado.avisos.map((a: Aviso) => ({
      nivel: a.nivel,
      fenomeno: a.fenomeno,
      zona: a.zona,
      inicio: str(a.onset),
      fin: str(a.expires),
      descripcion: str(a.descripcion),
      probabilidad: str(a.probabilidad),
    })),
  };
}

// ---------------------------------------------------------------------------
// buscar_estacion
// ---------------------------------------------------------------------------

const estacionDetalleSchema = z.object({
  idema: z.string().describe("Identificador de estación de AEMET"),
  nombre: z.string(),
  provincia: z.string().nullable(),
  latitud: z.number().nullable().describe("Grados decimales"),
  longitud: z.number().nullable().describe("Grados decimales; negativo al oeste"),
  altitud: z.number().nullable().describe("Metros sobre el nivel del mar"),
});

export const salidaBuscarEstacion = {
  consulta: z.string(),
  total: z.number().int(),
  estaciones: z.array(estacionDetalleSchema),
};

export function aEstacionDetalle(e: EstacionResuelta) {
  return {
    idema: e.idema,
    nombre: e.nombre,
    provincia: str(e.provincia),
    latitud: num(e.latitud),
    longitud: num(e.longitud),
    altitud: num(e.altitud),
  };
}

export function aSalidaBuscarEstacion(consulta: string, estaciones: EstacionResuelta[]) {
  return {
    consulta,
    total: estaciones.length,
    estaciones: estaciones.map(aEstacionDetalle),
  };
}

// ---------------------------------------------------------------------------
// observacion_municipio
// ---------------------------------------------------------------------------

const candidataSchema = estacionDetalleSchema.extend({
  distanciaKm: z.number().describe("Distancia al municipio, en km"),
});

export const salidaObservacionMunicipio = {
  municipio: municipioSchema,
  /** Ausente si ninguna estación cercana tenía datos. */
  estacion: candidataSchema.nullable(),
  fecha: z.string().nullable().describe("Momento del dato (UTC, ISO)"),
  temperatura: z.number().nullable().describe("°C"),
  humedadRelativa: z.number().nullable().describe("%"),
  precipitacion: z.number().nullable().describe("mm en la última hora"),
  viento: z.object({
    velocidad: z.number().nullable().describe("m/s"),
    direccion: z.number().nullable().describe("grados"),
  }),
  presion: z.number().nullable().describe("hPa"),
  candidatas: z
    .array(candidataSchema)
    .describe("Estaciones próximas ordenadas por distancia, para elegir otra"),
};

export function aSalidaObservacionMunicipio(
  m: Municipio,
  elegida: (EstacionResuelta & { distanciaKm: number }) | undefined,
  observacion: Observacion | undefined,
  candidatas: Array<EstacionResuelta & { distanciaKm: number }>,
) {
  const conDistancia = (e: EstacionResuelta & { distanciaKm: number }) => ({
    ...aEstacionDetalle(e),
    distanciaKm: Math.round(e.distanciaKm * 10) / 10,
  });

  return {
    municipio: aMunicipio(m),
    estacion: elegida ? conDistancia(elegida) : null,
    fecha: str(observacion?.fint),
    temperatura: num(observacion?.ta),
    humedadRelativa: num(observacion?.hr),
    precipitacion: num(observacion?.prec),
    viento: { velocidad: num(observacion?.vv), direccion: num(observacion?.dv) },
    presion: num(observacion?.pres),
    candidatas: candidatas.map(conDistancia),
  };
}

// ---------------------------------------------------------------------------
// avisos_municipio
// ---------------------------------------------------------------------------

export const salidaAvisosMunicipio = {
  municipio: municipioSchema,
  area: z.object({ codigo: z.string(), nombre: z.string() }),
  elaborado: z.string().nullable(),
  alcance: z
    .enum(["municipio", "comunidad"])
    .describe(
      "'municipio' si se pudo acotar por geometría de las zonas de aviso; " +
        "'comunidad' si hubo que devolver los de toda la CCAA",
    ),
  total: z.number().int().describe("Avisos que afectan al municipio"),
  totalComunidad: z.number().int().describe("Avisos vigentes en toda la CCAA"),
  nivelMaximo: z.enum(NIVELES).nullable(),
  porNivel: z.object({
    rojo: z.number().int(),
    naranja: z.number().int(),
    amarillo: z.number().int(),
  }),
  avisos: z.array(avisoSchema),
};

export function aSalidaAvisosMunicipio(
  m: Municipio,
  area: { codigo: string; nombre: string },
  resultado: ResultadoAvisos,
  avisosMunicipio: Aviso[],
  alcance: "municipio" | "comunidad",
) {
  const base = aSalidaAvisos(area, { ...resultado, avisos: avisosMunicipio });
  return {
    municipio: aMunicipio(m),
    area: base.area,
    elaborado: base.elaborado,
    alcance,
    total: base.total,
    totalComunidad: resultado.avisos.length,
    nivelMaximo: base.nivelMaximo,
    porNivel: base.porNivel,
    avisos: base.avisos,
  };
}

// ---------------------------------------------------------------------------
// Tipos derivados, para consumir la librería sin depender de zod
// ---------------------------------------------------------------------------

export type SalidaBuscarMunicipio = ReturnType<typeof aSalidaBuscarMunicipio>;
export type SalidaPrediccionDiaria = ReturnType<typeof aSalidaPrediccionDiaria>;
export type SalidaPrediccionHoraria = ReturnType<typeof aSalidaPrediccionHoraria>;
export type SalidaObservacion = ReturnType<typeof aSalidaObservacion>;
export type SalidaAvisos = ReturnType<typeof aSalidaAvisos>;
export type SalidaBuscarEstacion = ReturnType<typeof aSalidaBuscarEstacion>;
export type SalidaObservacionMunicipio = ReturnType<typeof aSalidaObservacionMunicipio>;
export type SalidaAvisosMunicipio = ReturnType<typeof aSalidaAvisosMunicipio>;
