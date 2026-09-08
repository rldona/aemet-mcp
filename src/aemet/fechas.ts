// Normalización de instantes a ISO 8601 con offset explícito.
//
// AEMET mezcla cuatro convenciones en la misma sesión: `elaborado` sin zona
// ("2026-09-08T07:15:12"), la observación con "+0000", los avisos CAP con
// "+02:00" y algún campo con "-00:00". Un consumidor que reciba las cuatro no
// puede comparar dos horas sin saber de dónde viene cada una.
//
// Aquí se dejan todas en la misma forma: `YYYY-MM-DDTHH:MM:SS±HH:MM`. Lo que NO
// se hace es inventar: una fecha sin zona solo recibe offset si quien llama dice
// en qué zona está expresada, y esa decisión se documenta en el schema de la
// herramienta para que el consumidor sepa que es una interpretación nuestra y no
// un dato de AEMET.

/** Zonas en las que AEMET expresa sus fechas sin decirlo. */
export type ZonaSupuesta = "UTC" | "Europe/Madrid";

const CON_FECHA_HORA =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/** Formatea un desfase en minutos como "+02:00" / "-01:00". */
function formatOffset(minutos: number): string {
  const signo = minutos < 0 ? "-" : "+";
  const abs = Math.abs(minutos);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${signo}${hh}:${mm}`;
}

/** Desfase de una zona respecto a UTC, en minutos, en un instante dado. */
function desfaseEn(zona: string, instante: number): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);

  const p: Record<string, number> = {};
  for (const parte of partes) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  const comoUtc = Date.UTC(
    p.year!,
    p.month! - 1,
    p.day!,
    // Intl puede dar "24" por medianoche en algunas versiones de ICU.
    p.hour! % 24,
    p.minute!,
    p.second!,
  );
  return Math.round((comoUtc - instante) / 60_000);
}

/**
 * Desfase que corresponde a una hora de pared en una zona.
 *
 * Se calcula en dos pasos porque el desfase depende del instante y el instante
 * depende del desfase: se parte de leer la hora local como si fuera UTC y se
 * corrige. Basta una corrección salvo en la hora repetida del cambio de hora,
 * donde cualquiera de las dos lecturas es defendible.
 */
function desfaseParaHoraLocal(zona: string, horaLocalComoUtc: number): number {
  const aproximado = desfaseEn(zona, horaLocalComoUtc);
  return desfaseEn(zona, horaLocalComoUtc - aproximado * 60_000);
}

/**
 * Deja un instante de AEMET en ISO 8601 con offset explícito.
 *
 * - Si ya trae zona ("Z", "+0000", "-00:00", "+02:00") solo se uniforma el
 *   formato; el instante no se toca.
 * - Si no la trae, se interpreta en `zonaSiNoLaTrae`. Esa suposición es del
 *   servidor, no de AEMET, y va documentada donde se expone el campo.
 * - Lo que no encaje se devuelve tal cual: mejor el dato crudo que uno inventado.
 */
export function isoConOffset(
  valor: string | undefined | null,
  zonaSiNoLaTrae: ZonaSupuesta,
): string | null {
  if (valor === undefined || valor === null) return null;
  const raw = String(valor).trim();
  if (!raw) return null;

  const m = CON_FECHA_HORA.exec(raw);
  if (!m) return raw;

  const [, y, mes, d, hh, mm, ss, zona] = m;
  const base = `${y}-${mes}-${d}T${hh}:${mm}:${ss ?? "00"}`;

  if (zona) {
    if (zona === "Z") return `${base}+00:00`;
    const conDosPuntos = zona.includes(":") ? zona : `${zona.slice(0, 3)}:${zona.slice(3)}`;
    // "-00:00" es UTC igual que "+00:00", pero el RFC lo reserva para "zona
    // desconocida"; uniformarlo evita que parezcan instantes distintos.
    return `${base}${conDosPuntos === "-00:00" ? "+00:00" : conDosPuntos}`;
  }

  if (zonaSiNoLaTrae === "UTC") return `${base}+00:00`;

  const comoUtc = Date.parse(`${base}Z`);
  if (!Number.isFinite(comoUtc)) return raw;
  return `${base}${formatOffset(desfaseParaHoraLocal(zonaSiNoLaTrae, comoUtc))}`;
}
