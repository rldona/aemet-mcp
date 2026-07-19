// Formateadores: convierten las respuestas de AEMET en texto legible (resumen +
// datos), no el JSON crudo. Acceso defensivo porque AEMET omite campos sin dato.

import type {
  Municipio,
  Observacion,
  PrediccionDiariaMunicipio,
  PrediccionHorariaMunicipio,
} from "./types.js";
import type { Aviso, NivelAviso, ResultadoAvisos } from "./avisos.js";

/** Elige el elemento con `periodo === target` o, en su defecto, el primero. */
function pickPeriodo<T extends { periodo?: string }>(
  arr: T[] | undefined,
  target = "00-24",
): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr.find((x) => x.periodo === target) ?? arr[0];
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

export function formatMunicipios(query: string, resultados: Municipio[]): string {
  if (resultados.length === 0) {
    return `No se encontró ningún municipio que coincida con "${query}".`;
  }
  const lineas = resultados.map((m) => `• ${m.nombre} — código INE ${m.codigo}`);
  const cabecera =
    resultados.length === 1
      ? `1 municipio coincide con "${query}":`
      : `${resultados.length} municipios coinciden con "${query}":`;
  return [cabecera, ...lineas].join("\n");
}

// ---------------------------------------------------------------------------
// prediccion_diaria
// ---------------------------------------------------------------------------

export function formatDiaria(pred: PrediccionDiariaMunicipio, maxDias: number): string {
  const dias = (pred.prediccion?.dia ?? []).slice(0, maxDias);
  const out: string[] = [];
  out.push(`Predicción diaria — ${pred.nombre} (${pred.provincia})`);
  out.push(`Elaborada: ${pred.elaborado?.replace("T", " ") ?? "—"}`);
  out.push("");

  for (const dia of dias) {
    const t = dia.temperatura ?? {};
    const cielo = pickPeriodo(dia.estadoCielo)?.descripcion ?? "—";
    const prob = pickPeriodo(dia.probPrecipitacion)?.value;
    const viento = pickPeriodo(dia.viento);

    const partes = [
      `  Máx ${fmtNum(t.maxima, "°C")} / Mín ${fmtNum(t.minima, "°C")}`,
      `Cielo: ${cielo}`,
      `Prob. precip.: ${prob !== undefined && prob !== "" ? `${prob}%` : "—"}`,
    ];
    if (viento?.velocidad !== undefined) {
      let v = `Viento: ${viento.direccion ?? ""} ${viento.velocidad} km/h`.trim();
      const racha = pickPeriodo(dia.rachaMax)?.value;
      if (racha) v += ` (racha ${racha} km/h)`;
      partes.push(v);
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

export function formatHoraria(pred: PrediccionHorariaMunicipio, maxDias: number): string {
  const dias = (pred.prediccion?.dia ?? []).slice(0, maxDias);
  const out: string[] = [];
  out.push(`Predicción horaria — ${pred.nombre} (${pred.provincia})`);
  out.push(`Elaborada: ${pred.elaborado?.replace("T", " ") ?? "—"}`);

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
      if (viento) cols.push(`viento ${viento.dir} ${viento.vel} km/h`);
      out.push(cols.join("  ·  "));
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// observacion_estacion
// ---------------------------------------------------------------------------

export function formatObservacion(
  registros: Observacion[],
  estacionNombre?: string,
): string {
  if (registros.length === 0) {
    return "La estación no tiene observaciones recientes disponibles.";
  }
  // El último registro es el más reciente.
  const o = registros[registros.length - 1]!;
  const nombre = estacionNombre ?? o.ubi ?? o.idema;
  const out: string[] = [];
  out.push(`Última observación — ${nombre} (estación ${o.idema})`);
  out.push(`Hora (UTC): ${o.fint ?? "—"}`);
  out.push("");
  out.push(`Temperatura:  ${fmtNum(o.ta, "°C")}`);
  out.push(`Humedad:      ${fmtNum(o.hr, "%")}`);
  out.push(`Precip. (última hora): ${fmtNum(o.prec, "mm")}`);
  out.push(`Viento:       ${fmtNum(o.vv, "m/s")}${o.dv !== undefined ? ` del ${o.dv}°` : ""}`);
  out.push(`Presión:      ${fmtNum(o.pres, "hPa")}`);
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
