// Formateadores: convierten las respuestas de AEMET en texto legible (resumen +
// datos), no el JSON crudo. Acceso defensivo porque AEMET omite campos sin dato.

import type {
  DiaDiaria,
  DiaHoraria,
  Municipio,
  Observacion,
  PrediccionDiariaMunicipio,
  PrediccionHorariaMunicipio,
  RangoHorario,
} from "./types.js";
import type { Aviso, NivelAviso, ResultadoAvisos } from "./avisos.js";
import { etiquetaMunicipio } from "./municipios.js";
import type { EstacionResuelta } from "./estaciones.js";
import { isoConOffset } from "./fechas.js";
import { textoViento, vientoDeObservacion, vientoDePrediccion } from "./viento.js";

/**
 * Elige el elemento con `periodo === target` o, en su defecto, el primero.
 *
 * El fallback al primero no es arbitrario, aunque lo parezca: AEMET estructura la
 * predicción diaria en dos formas (verificado en payloads reales, ver
 * `docs/aemet-api-notes.md`). Los días 0-3 traen siempre el agregado "00-24"
 * junto a los subperiodos, así que el `find` acierta. Los días 4-6 traen un
 * ÚNICO elemento sin campo `periodo`, que ya representa el día entero: ahí el
 * primero es el correcto porque es el único.
 */
export function pickPeriodo<T extends { periodo?: string }>(
  arr: T[] | undefined,
  target = "00-24",
): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr.find((x) => x.periodo === target) ?? arr[0];
}

/**
 * Probabilidad de precipitación del día.
 *
 * Igual que `pickPeriodo` salvo en un caso que hoy no se da pero que sería
 * silenciosamente erróneo si AEMET lo introdujera: varios subperiodos y ningún
 * "00-24". Coger el primero presentaría la probabilidad de la madrugada como la
 * del día entero; el agregado honesto es el máximo.
 */
export function probPrecipitacionDia(
  arr: RangoHorario[] | undefined,
): string | number | undefined {
  if (!arr || arr.length === 0) return undefined;

  const completo = arr.find((x) => x.periodo === "00-24");
  if (completo) return completo.value;
  if (arr.length === 1) return arr[0]!.value;

  let mejor: RangoHorario | undefined;
  let mejorValor = Number.NEGATIVE_INFINITY;
  for (const x of arr) {
    const n = Number(x.value);
    if (!Number.isFinite(n)) continue;
    if (n > mejorValor) {
      mejorValor = n;
      mejor = x;
    }
  }
  return (mejor ?? arr[0]!).value;
}

/**
 * Acota los días de una predicción por número y por rango de fechas.
 *
 * El rango existe porque sin él no había forma de pedir "este fin de semana":
 * había que traerse los siete días y descartar cinco, gastando contexto y
 * dejando al modelo la aritmética de calendario.
 */
export function seleccionarDias<T extends { fecha: string }>(
  dias: T[],
  opciones: { max?: number; desde?: string; hasta?: string } = {},
): T[] {
  const { max, desde, hasta } = opciones;
  let out = dias;
  if (desde) out = out.filter((d) => d.fecha.slice(0, 10) >= desde);
  if (hasta) out = out.filter((d) => d.fecha.slice(0, 10) <= hasta);
  return max === undefined ? out : out.slice(0, max);
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function fechaLegible(iso: string): string {
  // iso tipo "2026-07-19T00:00:00"
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso.slice(0, 10);
  const dow = DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${dow} ${dd}/${mm}`;
}

// ---------------------------------------------------------------------------
// buscar_municipio
// ---------------------------------------------------------------------------

export function formatMunicipios(
  query: string,
  resultados: Municipio[],
  isla?: string,
): string {
  if (resultados.length === 0) {
    return `No se encontró ningún municipio que coincida con "${query}".`;
  }
  const lineas = resultados.map((m) => `• ${etiquetaMunicipio(m)}`);
  if (isla) {
    return [
      `"${query}" es una isla (${isla}), no un municipio. Sus ${resultados.length} ` +
        `municipios, que es lo que entiende AEMET:`,
      ...lineas,
    ].join("\n");
  }
  const cabecera =
    resultados.length === 1
      ? `1 municipio coincide con "${query}":`
      : `${resultados.length} municipios coinciden con "${query}":`;
  return [cabecera, ...lineas].join("\n");
}

// ---------------------------------------------------------------------------
// prediccion_diaria
// ---------------------------------------------------------------------------

export function formatDiaria(
  pred: PrediccionDiariaMunicipio,
  dias: DiaDiaria[],
): string {
  const out: string[] = [];
  out.push(`Predicción diaria — ${pred.nombre} (${pred.provincia})`);
  out.push(`Elaborada: ${isoConOffset(pred.elaborado, "Europe/Madrid") ?? "—"}`);
  if (dias.length === 0) {
    out.push("");
    out.push("AEMET no publica ningún día dentro del rango pedido.");
    return out.join("\n");
  }
  out.push("");

  for (const dia of dias) {
    const t = dia.temperatura ?? {};
    const cielo = pickPeriodo(dia.estadoCielo)?.descripcion ?? "—";
    const prob = probPrecipitacionDia(dia.probPrecipitacion);
    const viento = pickPeriodo(dia.viento);

    const partes = [
      `  Máx ${fmtNum(t.maxima, "°C")} / Mín ${fmtNum(t.minima, "°C")}`,
      `Cielo: ${cielo}`,
      `Prob. precip.: ${prob !== undefined && prob !== "" ? `${prob}%` : "—"}`,
    ];
    if (viento?.velocidad !== undefined) {
      const v = vientoDePrediccion(viento.direccion, viento.velocidad);
      let linea = `Viento: ${textoViento(v)}`;
      const racha = pickPeriodo(dia.rachaMax)?.value;
      if (racha) linea += ` (racha ${racha} km/h)`;
      partes.push(linea);
    }
    const hr = dia.humedadRelativa;
    if (hr?.maxima !== undefined || hr?.minima !== undefined) {
      partes.push(`Humedad: ${fmtNum(hr.maxima, "%")} / ${fmtNum(hr.minima, "%")}`);
    }
    out.push(`${fechaLegible(dia.fecha)}`);
    out.push(partes.join("  |  "));
    out.push("");
  }
  return out.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// prediccion_horaria
// ---------------------------------------------------------------------------

export function formatHoraria(
  pred: PrediccionHorariaMunicipio,
  dias: DiaHoraria[],
): string {
  const out: string[] = [];
  out.push(`Predicción horaria — ${pred.nombre} (${pred.provincia})`);
  out.push(`Elaborada: ${isoConOffset(pred.elaborado, "Europe/Madrid") ?? "—"}`);
  if (dias.length === 0) {
    out.push("");
    out.push("AEMET no publica ningún día dentro del rango pedido.");
    return out.join("\n");
  }

  for (const dia of dias) {
    out.push("");
    out.push(`── ${fechaLegible(dia.fecha)} ──`);

    // Índices por hora para cruzar temperatura/cielo/precip/viento.
    const cieloPorHora = indexByPeriodo(dia.estadoCielo);
    const precipPorHora = indexByPeriodo(dia.precipitacion);
    const vientoPorHora = indexVientoHorario(dia.vientoAndRachaMax);

    const temps = dia.temperatura ?? [];
    if (!Array.isArray(temps) || temps.length === 0) {
      out.push("  (sin datos horarios)");
      continue;
    }

    for (const t of temps) {
      const h = t.periodo ?? "";
      const cielo = cieloPorHora.get(h)?.descripcion ?? "";
      const precip = precipPorHora.get(h)?.value;
      const viento = vientoPorHora.get(h);
      const cols = [`  ${h.padStart(2, "0")}:00`, `${t.value ?? "—"}°C`];
      if (cielo) cols.push(cielo);
      if (precip !== undefined && precip !== "" && precip !== "0") cols.push(`lluvia ${precip} mm`);
      if (viento) {
        cols.push(`viento ${textoViento(vientoDePrediccion(viento.dir, Number(viento.vel)))}`);
      }
      out.push(cols.join("  ·  "));
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// observacion_estacion
// ---------------------------------------------------------------------------

/**
 * Elige la observación más reciente comparando `fint`.
 *
 * AEMET devuelve el array en orden cronológico, así que coger el último
 * funcionaba, pero es una suposición sobre el proveedor que nada garantiza y que
 * fallaría en silencio dando un dato viejo por actual. Los registros sin `fint`
 * o con una fecha ilegible no compiten; si ninguno trae fecha usable se conserva
 * el criterio anterior (el último) en vez de no devolver nada.
 */
export function observacionMasReciente(
  registros: Observacion[],
): Observacion | undefined {
  let mejor: Observacion | undefined;
  let mejorInstante = Number.NEGATIVE_INFINITY;

  for (const r of registros) {
    const instante = r.fint ? Date.parse(r.fint) : Number.NaN;
    if (!Number.isFinite(instante)) continue;
    if (instante > mejorInstante) {
      mejorInstante = instante;
      mejor = r;
    }
  }

  return mejor ?? registros[registros.length - 1];
}

export function formatObservacion(
  registros: Observacion[],
  estacionNombre?: string,
): string {
  if (registros.length === 0) {
    return "La estación no tiene observaciones recientes disponibles.";
  }
  const o = observacionMasReciente(registros)!;
  const nombre = estacionNombre ?? o.ubi ?? o.idema;
  const out: string[] = [];
  out.push(`Última observación — ${nombre} (estación ${o.idema})`);
  out.push(`Hora del dato: ${isoConOffset(o.fint, "UTC") ?? "—"}`);
  out.push("");
  out.push(...lineasObservacion(o));
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// avisos
// ---------------------------------------------------------------------------

const NIVEL_EMOJI: Record<NivelAviso, string> = {
  rojo: "🔴",
  naranja: "🟠",
  amarillo: "🟡",
};
const NIVELES_ORDEN: NivelAviso[] = ["rojo", "naranja", "amarillo"];

/** "2026-07-19T13:00:00+02:00" -> "19/07 13:00" (hora local de AEMET). */
function fechaHoraCorta(iso?: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]} ${m[4]}:${m[5]}`;
}

const MAX_AVISOS_LISTADOS = 60;

export function formatAvisos(ccaa: string, resultado: ResultadoAvisos): string {
  const { avisos, elaborado } = resultado;
  if (avisos.length === 0) {
    return `Sin avisos meteorológicos activos en ${ccaa} ahora mismo.`;
  }

  const porNivel: Record<NivelAviso, number> = { rojo: 0, naranja: 0, amarillo: 0 };
  for (const a of avisos) porNivel[a.nivel]++;
  const nivelMax = NIVELES_ORDEN.find((n) => porNivel[n] > 0) ?? "amarillo";

  const out: string[] = [];
  out.push(`Avisos meteorológicos vigentes — ${ccaa}`);
  if (elaborado) out.push(`Elaborado: ${elaborado.replace("T", " ").slice(0, 19)}`);
  const desglose = NIVELES_ORDEN.filter((n) => porNivel[n] > 0)
    .map((n) => `${porNivel[n]} ${n}`)
    .join(", ");
  out.push(`${avisos.length} avisos (${desglose}). Nivel máximo: ${nivelMax.toUpperCase()}.`);

  out.push(...cuerpoAvisos(avisos));
  return out.join("\n");
}

/** Lista de avisos agrupada por nivel, acotada a MAX_AVISOS_LISTADOS. */
function cuerpoAvisos(avisos: Aviso[]): string[] {
  const out: string[] = [];
  let listados = 0;
  for (const nivel of NIVELES_ORDEN) {
    const delNivel = avisos.filter((a) => a.nivel === nivel);
    if (delNivel.length === 0) continue;
    out.push("");
    out.push(`${NIVEL_EMOJI[nivel]} ${nivel.toUpperCase()} (${delNivel.length})`);
    for (const a of delNivel) {
      if (listados >= MAX_AVISOS_LISTADOS) break;
      out.push(`  • ${lineaAviso(a)}`);
      listados++;
    }
  }
  if (listados < avisos.length) {
    out.push("");
    out.push(`… y ${avisos.length - listados} avisos más (mismos niveles).`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// buscar_estacion
// ---------------------------------------------------------------------------

export function formatEstaciones(
  consulta: string,
  estaciones: EstacionResuelta[],
): string {
  if (estaciones.length === 0) {
    return `No se encontró ninguna estación que coincida con "${consulta}".`;
  }
  const lineas = estaciones.map((e) => {
    const partes = [`• ${e.nombre} — idema ${e.idema}`];
    if (e.provincia) partes.push(e.provincia);
    if (e.latitud !== undefined && e.longitud !== undefined) {
      partes.push(`${e.latitud.toFixed(4)}, ${e.longitud.toFixed(4)}`);
    }
    if (e.altitud !== undefined) partes.push(`${e.altitud} m`);
    return partes.join("  ·  ");
  });
  const cabecera =
    estaciones.length === 1
      ? `1 estación coincide con "${consulta}":`
      : `${estaciones.length} estaciones coinciden con "${consulta}":`;
  return [cabecera, ...lineas].join("\n");
}

// ---------------------------------------------------------------------------
// observacion_municipio
// ---------------------------------------------------------------------------

export function formatObservacionMunicipio(
  m: Municipio,
  elegida: (EstacionResuelta & { distanciaKm: number }) | undefined,
  observacion: Observacion | undefined,
  candidatas: Array<EstacionResuelta & { distanciaKm: number }>,
  advertencia?: string | null,
): string {
  if (!elegida || !observacion) {
    const lista = candidatas
      .map((c) => `  - ${c.nombre} (idema ${c.idema}, a ${c.distanciaKm.toFixed(1)} km)`)
      .join("\n");
    return (
      `Ninguna de las ${candidatas.length} estaciones más cercanas a ` +
      `${m.nombreNatural} (${m.provincia}) publica observación ahora mismo.\n${lista}`
    );
  }

  const out: string[] = [];
  out.push(`Tiempo actual cerca de ${m.nombreNatural} (${m.provincia})`);

  // La advertencia va ARRIBA, antes que los números. Abajo se lee como una nota
  // al pie y el modelo ya ha decidido que 23,7 °C es la temperatura del pueblo.
  if (advertencia) {
    out.push("");
    out.push(`⚠️  ${advertencia}`);
  }

  out.push("");
  out.push(
    `Estación: ${elegida.nombre} (idema ${elegida.idema})` +
      `${elegida.provincia ? `, ${elegida.provincia}` : ""}, a ` +
      `${elegida.distanciaKm.toFixed(1)} km del municipio`,
  );
  out.push(`Hora del dato: ${isoConOffset(observacion.fint, "UTC") ?? "—"}`);
  out.push("");
  out.push(...lineasObservacion(observacion));

  const otras = candidatas.filter((c) => c.idema !== elegida.idema);
  if (otras.length > 0) {
    out.push("");
    out.push(
      `Otras estaciones cercanas: ` +
        otras.map((c) => `${c.nombre} (${c.idema}, ${c.distanciaKm.toFixed(1)} km)`).join("; "),
    );
  }
  return out.join("\n");
}

/** Bloque de magnitudes común a las dos observaciones, ya en unidades únicas. */
function lineasObservacion(o: Observacion): string[] {
  const viento = vientoDeObservacion(o.dv ?? null, o.vv ?? null);
  return [
    `Temperatura:  ${fmtNum(o.ta, "°C")}`,
    `Humedad:      ${fmtNum(o.hr, "%")}`,
    `Precip. (última hora): ${fmtNum(o.prec, "mm")}`,
    `Viento:       ${textoViento(viento, true)}`,
    `Presión:      ${fmtNum(o.pres, "hPa")}`,
  ];
}

// ---------------------------------------------------------------------------
// avisos_municipio
// ---------------------------------------------------------------------------

export function formatAvisosMunicipio(
  m: Municipio,
  ccaa: { codigo: string; nombre: string },
  resultado: ResultadoAvisos,
  avisos: Aviso[],
  alcance: "municipio" | "comunidad",
  opciones: {
    nota?: string | null;
    incluirComunidad?: boolean;
    /** Avisos de la CCAA que NO cubren el municipio, ya calculados. */
    fuera?: Aviso[];
  } = {},
): string {
  const out: string[] = [];
  const donde = `${m.nombreNatural} (${m.provincia}), ${ccaa.nombre}`;
  const nota = opciones.nota ? `\n${opciones.nota}` : "";

  if (avisos.length === 0) {
    const detalle =
      resultado.avisos.length > 0
        ? ` Hay ${resultado.avisos.length} avisos en ${ccaa.nombre}, pero ninguno cubre el municipio.`
        : "";
    return `Sin avisos meteorológicos vigentes en ${donde}.${detalle}${nota}`;
  }

  out.push(`Avisos meteorológicos vigentes — ${donde}`);
  if (opciones.nota) out.push(opciones.nota);
  if (resultado.elaborado) {
    out.push(`Elaborado: ${resultado.elaborado.replace("T", " ").slice(0, 19)}`);
  }

  const porNivel: Record<NivelAviso, number> = { rojo: 0, naranja: 0, amarillo: 0 };
  for (const a of avisos) porNivel[a.nivel]++;
  const nivelMax = NIVELES_ORDEN.find((n) => porNivel[n] > 0) ?? "amarillo";
  const desglose = NIVELES_ORDEN.filter((n) => porNivel[n] > 0)
    .map((n) => `${porNivel[n]} ${n}`)
    .join(", ");
  out.push(`${avisos.length} avisos (${desglose}). Nivel máximo: ${nivelMax.toUpperCase()}.`);

  // Decir siempre qué se está mirando: no es lo mismo "estos avisos cubren tu
  // municipio" que "estos son los de toda la comunidad, no he podido acotar".
  out.push(
    alcance === "municipio"
      ? `Alcance: acotado al municipio por la geometría de las zonas de aviso ` +
          `(${resultado.avisos.length} vigentes en toda ${ccaa.nombre}).`
      : `Alcance: TODA ${ccaa.nombre}; no se pudo acotar al municipio, así que ` +
          `puede haber avisos que no le afecten.`,
  );

  out.push(...cuerpoAvisos(avisos));

  // El resto de la comunidad: o se enseña, o se dice cómo pedirlo. Decir solo
  // "hay 3 en la comunidad" y mostrar 1 obligaba a una segunda llamada.
  const fuera = opciones.fuera ?? [];
  const restantes = resultado.avisos.length - avisos.length;
  if (restantes > 0) {
    out.push("");
    if (opciones.incluirComunidad) {
      out.push(`Los otros ${restantes} avisos de ${ccaa.nombre}, que no cubren el municipio:`);
      for (const a of fuera.slice(0, MAX_AVISOS_LISTADOS)) {
        out.push(`  · ${NIVEL_EMOJI[a.nivel]} ${lineaAviso(a)}`);
      }
    } else {
      out.push(
        `Hay ${restantes} avisos más en ${ccaa.nombre} que no cubren este ` +
          `municipio. Si necesitas verlos, repite con incluirComunidad: true.`,
      );
    }
  }

  return out.join("\n");
}

function lineaAviso(a: Aviso): string {
  const periodo = `${fechaHoraCorta(a.onset)} → ${fechaHoraCorta(a.expires)}`;
  const partes = [`${a.zona}: ${a.fenomeno}`, periodo];
  if (a.descripcion) partes.push(a.descripcion);
  if (a.probabilidad) partes.push(`prob. ${a.probabilidad}`);
  return partes.join("  ·  ");
}

// ---------------------------------------------------------------------------
// helpers internos
// ---------------------------------------------------------------------------

function fmtNum(v: number | undefined, unit: string): string {
  return v === undefined || v === null || Number.isNaN(v) ? "—" : `${v} ${unit}`.trim();
}

function indexByPeriodo<T extends { periodo?: string }>(
  arr: T[] | undefined,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of arr ?? []) {
    if (item.periodo !== undefined) map.set(item.periodo, item);
  }
  return map;
}

/** El viento horario viene mezclado con la racha; extraemos dir/vel por hora. */
function indexVientoHorario(
  arr: unknown[] | undefined,
): Map<string, { dir: string; vel: string }> {
  const map = new Map<string, { dir: string; vel: string }>();
  for (const raw of arr ?? []) {
    const item = raw as {
      periodo?: string;
      direccion?: string[];
      velocidad?: string[];
    };
    if (item.periodo && Array.isArray(item.direccion) && Array.isArray(item.velocidad)) {
      map.set(item.periodo, {
        dir: item.direccion[0] ?? "",
        vel: item.velocidad[0] ?? "",
      });
    }
  }
  return map;
}
