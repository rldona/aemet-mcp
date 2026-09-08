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
// "no hay dato" y punto.
//
// Las unidades van DOS veces: en el `.describe()` de cada campo (que solo llega
// al cliente si lee el outputSchema) y en un campo `unidades` del propio
// payload. La duplicación es deliberada: en una sesión real el modelo ve el JSON
// y no el schema, y sin las unidades dentro un `velocidad: 9` no se distingue de
// un `velocidad: 2.5` en otra unidad.

import { z } from "zod";
import type { Municipio, Observacion, PrediccionDiariaMunicipio, PrediccionHorariaMunicipio, DiaDiaria, DiaHoraria } from "../aemet/types.js";
import type { Aviso, NivelAviso, ResultadoAvisos } from "../aemet/avisos.js";
import { pickPeriodo, resumenDiaDiaria } from "../aemet/format.js";
import type { EstacionResuelta } from "../aemet/estaciones.js";
import { isoConOffset } from "../aemet/fechas.js";
import { mismaProvincia } from "../aemet/provincias.js";
import { vientoDeObservacion, vientoDePrediccion } from "../aemet/viento.js";

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

const unidadesSchema = z
  .record(z.string())
  .describe(
    "Unidad de cada magnitud de esta respuesta. Va en el payload para no tener " +
      "que suponerla ni deducirla del orden de magnitud.",
  );

const RUMBOS_DOC = "rumbo de 8 (N, NE, E, SE, S, SO, O, NO); 'C' = calma";
const ELABORADO_DOC =
  "ISO 8601 con offset. AEMET lo publica sin zona; se interpreta como hora " +
  "peninsular española (Europe/Madrid), que es lo que usa para producción.";
const PERIODO_DOC =
  "Tramo horario del que salen cielo, viento y racha, 'HH-HH'. '00-24' es el día " +
  "entero; cualquier otro valor va con diaCompleto false.";

export const municipioSchema = z.object({
  codigo: z.string().describe("Código INE de 5 dígitos"),
  nombre: z.string().describe("Nombre en forma natural, p. ej. 'el Campello'"),
  nombreINE: z.string().describe("Nombre del nomenclátor del INE, p. ej. 'Campello, el'"),
  provincia: z.string(),
  isla: z
    .string()
    .nullable()
    .describe("Isla en Canarias y Baleares; null en la península, Ceuta y Melilla"),
});

export function aMunicipio(m: Municipio): z.infer<typeof municipioSchema> {
  return {
    codigo: m.codigo,
    nombre: m.nombreNatural,
    nombreINE: m.nombre,
    provincia: m.provincia,
    isla: m.isla ?? null,
  };
}

const vientoSchema = z.object({
  velocidad: z.number().nullable().describe("km/h"),
  direccion: z.string().nullable().describe(RUMBOS_DOC),
  direccionGrados: z
    .number()
    .nullable()
    .describe("Grados desde el norte; null en calma o sin dato"),
});

// ---------------------------------------------------------------------------
// buscar_municipio
// ---------------------------------------------------------------------------

export const salidaBuscarMunicipio = {
  consulta: z.string().describe("Texto buscado"),
  total: z.number().int().describe("Municipios devueltos (acotado por el límite)"),
  isla: z
    .string()
    .nullable()
    .describe(
      "Rellena si lo buscado era el nombre de una isla; entonces los resultados " +
        "son sus municipios, aunque su nombre no contenga el de la isla.",
    ),
  municipios: z.array(municipioSchema),
};

export function aSalidaBuscarMunicipio(
  consulta: string,
  resultados: Municipio[],
  isla?: string,
) {
  return {
    consulta,
    total: resultados.length,
    isla: isla ?? null,
    municipios: resultados.map(aMunicipio),
  };
}

// ---------------------------------------------------------------------------
// prediccion_diaria
// ---------------------------------------------------------------------------

const UNIDADES_DIARIA = {
  temperaturaMaxima: "°C",
  temperaturaMinima: "°C",
  probabilidadPrecipitacion: "%",
  humedadRelativa: "%",
  "viento.velocidad": "km/h",
  "viento.rachaMaxima": "km/h",
  "viento.direccion": RUMBOS_DOC,
  "viento.direccionGrados": "grados desde el norte",
  fecha: "fecha local, YYYY-MM-DD",
  periodo: PERIODO_DOC,
  elaborado: ELABORADO_DOC,
};

const diaDiariaSchema = z.object({
  fecha: z.string().describe("Fecha ISO YYYY-MM-DD"),
  temperaturaMaxima: z.number().nullable().describe("°C"),
  temperaturaMinima: z.number().nullable().describe("°C"),
  cielo: z
    .string()
    .nullable()
    .describe("Estado del cielo. null = AEMET no lo publica; no significa despejado."),
  probabilidadPrecipitacion: z
    .number()
    .nullable()
    .describe("%. null = AEMET no lo publica; no significa 0."),
  periodo: z.string().describe(PERIODO_DOC),
  diaCompleto: z
    .boolean()
    .describe(
      "false cuando cielo, viento y lluvia salen de un tramo del día en vez del día " +
        "entero. Pasa con el día EN CURSO: AEMET vacía el agregado 00-24 y los tramos " +
        "ya pasados. Hay que decírselo al usuario en vez de darlo como el día completo.",
    ),
  viento: vientoSchema.extend({
    rachaMaxima: z
      .number()
      .nullable()
      .describe("km/h. null significa que AEMET no publica racha para ese día, no que no haya."),
  }),
  humedadRelativa: z.object({
    maxima: z.number().nullable().describe("%"),
    minima: z.number().nullable().describe("%"),
  }),
});

export const salidaPrediccionDiaria = {
  municipio: municipioSchema,
  elaborado: z.string().nullable().describe(ELABORADO_DOC),
  unidades: unidadesSchema,
  dias: z.array(diaDiariaSchema),
};

export function aSalidaPrediccionDiaria(
  m: Municipio,
  pred: PrediccionDiariaMunicipio,
  seleccion: DiaDiaria[],
) {
  const dias = seleccion.map((dia) => {
    // Mismo resumen que usa el texto: si aquí se recalculara aparte, el JSON y
    // lo que lee el usuario podrían discrepar.
    const r = resumenDiaDiaria(dia);
    const viento = vientoDePrediccion(r.viento?.direccion, num(r.viento?.velocidad));
    return {
      fecha: dia.fecha.slice(0, 10),
      temperaturaMaxima: num(dia.temperatura?.maxima),
      temperaturaMinima: num(dia.temperatura?.minima),
      cielo: str(r.cielo),
      probabilidadPrecipitacion: num(r.prob),
      viento: { ...viento, rachaMaxima: num(r.racha) },
      humedadRelativa: {
        maxima: num(dia.humedadRelativa?.maxima),
        minima: num(dia.humedadRelativa?.minima),
      },
      periodo: r.periodo,
      diaCompleto: r.diaCompleto,
    };
  });

  return {
    municipio: aMunicipio(m),
    elaborado: isoConOffset(pred.elaborado, "Europe/Madrid"),
    unidades: UNIDADES_DIARIA,
    dias,
  };
}

// ---------------------------------------------------------------------------
// prediccion_horaria
// ---------------------------------------------------------------------------

const UNIDADES_HORARIA = {
  temperatura: "°C",
  precipitacion: "mm en esa hora",
  "viento.velocidad": "km/h",
  "viento.direccion": RUMBOS_DOC,
  "viento.direccionGrados": "grados desde el norte",
  hora: "hora local española, 'HH'",
  fecha: "fecha local, YYYY-MM-DD",
  elaborado: ELABORADO_DOC,
};

const horaSchema = z.object({
  hora: z.string().describe("Hora local en formato 'HH'"),
  temperatura: z.number().nullable().describe("°C"),
  cielo: z.string().nullable(),
  precipitacion: z.number().nullable().describe("mm en esa hora"),
  viento: vientoSchema,
});

export const salidaPrediccionHoraria = {
  municipio: municipioSchema,
  elaborado: z.string().nullable().describe(ELABORADO_DOC),
  unidades: unidadesSchema,
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
  seleccion: DiaHoraria[],
) {
  const dias = seleccion.map((dia) => {
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
        viento: vientoDePrediccion(v?.direccion?.[0], num(v?.velocidad?.[0])),
      };
    });

    return { fecha: dia.fecha.slice(0, 10), horas };
  });

  return {
    municipio: aMunicipio(m),
    elaborado: isoConOffset(pred.elaborado, "Europe/Madrid"),
    unidades: UNIDADES_HORARIA,
    dias,
  };
}

// ---------------------------------------------------------------------------
// observacion
// ---------------------------------------------------------------------------

const UNIDADES_OBSERVACION = {
  temperatura: "°C",
  humedadRelativa: "%",
  precipitacion: "mm en la última hora",
  presion: "hPa",
  "viento.velocidad": "km/h (AEMET lo publica en m/s; aquí va convertido)",
  "viento.direccion": RUMBOS_DOC,
  "viento.direccionGrados": "grados desde el norte",
  fecha: "ISO 8601 con offset; el dato de observación es UTC",
  distanciaKm: "km en línea recta",
};

export const estacionSchema = z.object({
  idema: z.string().describe("Identificador de estación de AEMET"),
  nombre: z.string(),
  provincia: z.string().nullable(),
});

export const salidaObservacion = {
  estacion: estacionSchema,
  fecha: z.string().nullable().describe("Momento del dato, ISO 8601 con offset (UTC)"),
  unidades: unidadesSchema,
  temperatura: z.number().nullable().describe("°C"),
  humedadRelativa: z.number().nullable().describe("%"),
  precipitacion: z.number().nullable().describe("mm en la última hora"),
  viento: vientoSchema,
  presion: z.number().nullable().describe("hPa"),
};

export function aSalidaObservacion(o: Observacion, estacion?: EstacionResuelta) {
  return {
    estacion: {
      idema: o.idema,
      nombre: estacion?.nombre ?? o.ubi ?? o.idema,
      provincia: str(estacion?.provincia),
    },
    fecha: isoConOffset(o.fint, "UTC"),
    unidades: UNIDADES_OBSERVACION,
    temperatura: num(o.ta),
    humedadRelativa: num(o.hr),
    precipitacion: num(o.prec),
    viento: vientoDeObservacion(num(o.dv), num(o.vv)),
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
  inicio: z.string().nullable().describe("ISO 8601 con offset"),
  fin: z.string().nullable().describe("ISO 8601 con offset"),
  descripcion: z.string().nullable(),
  probabilidad: z.string().nullable().describe("Rango, p. ej. '40%-70%'"),
});

export const salidaAvisos = {
  area: z.object({
    codigo: z.string().describe("Código de área CAP de AEMET"),
    nombre: z.string().describe("Comunidad autónoma"),
  }),
  elaborado: z.string().nullable().describe("ISO 8601 con offset"),
  total: z.number().int(),
  nivelMaximo: z.enum(NIVELES).nullable().describe("null si no hay avisos"),
  porNivel: z.object({
    rojo: z.number().int(),
    naranja: z.number().int(),
    amarillo: z.number().int(),
  }),
  avisos: z.array(avisoSchema),
};

function aAviso(a: Aviso) {
  return {
    nivel: a.nivel,
    fenomeno: a.fenomeno,
    zona: a.zona,
    inicio: isoConOffset(a.onset, "Europe/Madrid"),
    fin: isoConOffset(a.expires, "Europe/Madrid"),
    descripcion: str(a.descripcion),
    probabilidad: str(a.probabilidad),
  };
}

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
    elaborado: isoConOffset(resultado.elaborado, "Europe/Madrid"),
    total: resultado.avisos.length,
    nivelMaximo,
    porNivel,
    avisos: resultado.avisos.map(aAviso),
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

/**
 * A partir de aquí la estación deja de representar razonablemente al municipio.
 *
 * No es un número mágico: en el muestreo de campo la mediana de distancia a la
 * estación con datos fue 12,4 km y el percentil 90, 19 km. El caso que motivó
 * esto es Ceuta, cuya estación con datos más cercana está a 29,7 km AL OTRO LADO
 * DEL ESTRECHO. El dato sigue sirviéndose —es lo mejor que hay— pero deja de
 * presentarse como si fuera la temperatura del municipio.
 */
export const DISTANCIA_FIABLE_KM = 20;

/** Qué se sabe de una candidata: se prueban en orden y se para en la primera con datos. */
const ESTADO_CANDIDATA = ["con datos", "sin datos", "no consultada"] as const;
export type EstadoCandidata = (typeof ESTADO_CANDIDATA)[number];

const candidataSchema = estacionDetalleSchema.extend({
  distanciaKm: z.number().describe("Distancia al municipio, en km"),
  estado: z
    .enum(ESTADO_CANDIDATA)
    .describe(
      "'con datos' y 'sin datos' son comprobados; 'no consultada' significa que " +
        "no hizo falta llegar a ella, no que no tenga datos.",
    ),
});

export const salidaObservacionMunicipio = {
  municipio: municipioSchema,
  /** null si ninguna estación cercana tenía datos. */
  estacion: candidataSchema.nullable(),
  advertencia: z
    .string()
    .nullable()
    .describe(
      "Rellena cuando el dato NO representa bien al municipio (estación lejana o " +
        "en otra provincia). Si viene, hay que trasladárselo al usuario.",
    ),
  representaAlMunicipio: z
    .boolean()
    .describe(
      `false si la estación está a más de ${DISTANCIA_FIABLE_KM} km o en otra provincia`,
    ),
  fecha: z.string().nullable().describe("Momento del dato, ISO 8601 con offset (UTC)"),
  unidades: unidadesSchema,
  temperatura: z.number().nullable().describe("°C"),
  humedadRelativa: z.number().nullable().describe("%"),
  precipitacion: z.number().nullable().describe("mm en la última hora"),
  viento: vientoSchema,
  presion: z.number().nullable().describe("hPa"),
  candidatas: z
    .array(candidataSchema)
    .describe("Estaciones próximas ordenadas por distancia, para elegir otra"),
};

export type Candidata = EstacionResuelta & { distanciaKm: number };

/**
 * ¿Representa esta estación al municipio? Dos criterios independientes: la
 * distancia y el cruce de provincia. El segundo importa porque una estación
 * puede estar cerca en línea recta y en otro régimen climático (Ceuta y Tarifa
 * están a 29,7 km con el Estrecho en medio).
 */
export function evaluarEstacion(
  m: Municipio,
  estacion: Candidata,
): { representa: boolean; advertencia: string | null } {
  const lejos = estacion.distanciaKm > DISTANCIA_FIABLE_KM;
  const otraProvincia =
    !!estacion.provincia && !mismaProvincia(estacion.provincia, m.provincia);

  if (!lejos && !otraProvincia) return { representa: true, advertencia: null };

  const motivos: string[] = [];
  if (lejos) motivos.push(`a ${estacion.distanciaKm.toFixed(1)} km`);
  if (otraProvincia) motivos.push(`en otra provincia (${estacion.provincia})`);

  return {
    representa: false,
    advertencia:
      `El dato NO es de ${m.nombreNatural}: la estación más cercana con ` +
      `observación es ${estacion.nombre} (${estacion.idema}), y está ${motivos.join(" y ")}. ` +
      `Preséntalo como una referencia próxima, no como el tiempo del municipio.`,
  };
}

export function aSalidaObservacionMunicipio(
  m: Municipio,
  elegida: Candidata | undefined,
  observacion: Observacion | undefined,
  candidatas: Candidata[],
  estados: Map<string, EstadoCandidata>,
) {
  const conDistancia = (e: Candidata) => ({
    ...aEstacionDetalle(e),
    distanciaKm: Math.round(e.distanciaKm * 10) / 10,
    estado: estados.get(e.idema) ?? ("no consultada" as EstadoCandidata),
  });

  const evaluacion = elegida
    ? evaluarEstacion(m, elegida)
    : { representa: false, advertencia: null };

  return {
    municipio: aMunicipio(m),
    estacion: elegida ? conDistancia(elegida) : null,
    advertencia: evaluacion.advertencia,
    representaAlMunicipio: evaluacion.representa,
    fecha: isoConOffset(observacion?.fint, "UTC"),
    unidades: UNIDADES_OBSERVACION,
    temperatura: num(observacion?.ta),
    humedadRelativa: num(observacion?.hr),
    precipitacion: num(observacion?.prec),
    viento: vientoDeObservacion(num(observacion?.dv), num(observacion?.vv)),
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
  elaborado: z.string().nullable().describe("ISO 8601 con offset"),
  alcance: z
    .enum(["municipio", "comunidad"])
    .describe(
      "'municipio' si se pudo acotar por geometría de las zonas de aviso; " +
        "'comunidad' si hubo que devolver los de toda la CCAA",
    ),
  nota: z
    .string()
    .nullable()
    .describe(
      "Aclaración sobre cómo se interpretó la consulta, p. ej. cuando el nombre " +
        "es a la vez de municipio y de comunidad autónoma.",
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
  avisosComunidad: z
    .array(avisoSchema)
    .nullable()
    .describe(
      "Todos los avisos de la CCAA, solo si se pidió incluirComunidad. null si " +
        "no se pidió: evita una segunda llamada cuando hace falta el contexto.",
    ),
};

export function aSalidaAvisosMunicipio(
  m: Municipio,
  area: { codigo: string; nombre: string },
  resultado: ResultadoAvisos,
  avisosMunicipio: Aviso[],
  alcance: "municipio" | "comunidad",
  opciones: { nota?: string | null; incluirComunidad?: boolean; fuera?: Aviso[] } = {},
) {
  const base = aSalidaAvisos(area, { ...resultado, avisos: avisosMunicipio });
  return {
    municipio: aMunicipio(m),
    area: base.area,
    elaborado: isoConOffset(resultado.elaborado, "Europe/Madrid"),
    alcance,
    nota: opciones.nota ?? null,
    total: base.total,
    totalComunidad: resultado.avisos.length,
    nivelMaximo: base.nivelMaximo,
    porNivel: base.porNivel,
    avisos: base.avisos,
    avisosComunidad: opciones.incluirComunidad ? resultado.avisos.map(aAviso) : null,
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
