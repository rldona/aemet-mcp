// Viento: una sola unidad y un solo vocabulario de direcciones.
//
// AEMET no es consistente consigo mismo. La predicción da la dirección como
// rumbo ("NE", "SO") y la velocidad en km/h; la observación da la dirección en
// grados y la velocidad en m/s. Servir las dos formas tal cual obligaba a
// adivinar: un `velocidad: 2.5` y un `velocidad: 20` en el mismo servidor no se
// distinguen si no sabes de qué endpoint salió cada uno.
//
// Aquí se unifica: km/h siempre, y las dos representaciones de la dirección
// (rumbo y grados) en todas las respuestas, calculando la que falte.

/** Rosa de 8 rumbos, que es la que usa AEMET en la predicción. */
export const RUMBOS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"] as const;
export type Rumbo = (typeof RUMBOS)[number];

/** Marca de calma en la predicción de AEMET: sin viento, sin dirección. */
export const CALMA = "C";

/** m/s -> km/h, redondeado a un decimal. */
export function msAKmh(ms: number): number {
  return Math.round(ms * 3.6 * 10) / 10;
}

/**
 * Grados desde el norte -> rumbo de 8. Cada sector abarca 45°, centrado en su
 * rumbo, así que el corte va en los 22,5° de cada lado.
 */
export function rumboDesdeGrados(grados: number | null | undefined): Rumbo | null {
  if (grados === null || grados === undefined || !Number.isFinite(grados)) return null;
  const normalizados = ((grados % 360) + 360) % 360;
  return RUMBOS[Math.round(normalizados / 45) % 8]!;
}

/**
 * Rumbo -> grados. Acepta también los 16 rumbos por si AEMET los emite, y las
 * formas inglesas (W por O), que aparecen en algunos campos.
 */
const GRADOS_POR_RUMBO: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSO: 202.5, SO: 225, OSO: 247.5,
  O: 270, ONO: 292.5, NO: 315, NNO: 337.5,
  // Equivalencias inglesas: W = O (oeste).
  SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

export function gradosDesdeRumbo(rumbo: string | null | undefined): number | null {
  if (!rumbo) return null;
  const clave = rumbo.trim().toUpperCase();
  if (clave === CALMA) return null; // calma: no hay dirección que dar
  return GRADOS_POR_RUMBO[clave] ?? null;
}

/** Viento ya normalizado, tal como sale en las respuestas de las herramientas. */
export interface VientoNormalizado {
  /** km/h. `null` si AEMET no lo da. */
  velocidad: number | null;
  /** Rumbo de 8 ("NE"), o "C" si AEMET marca calma. `null` si no hay dato. */
  direccion: string | null;
  /** Grados desde el norte. `null` en calma o sin dato. */
  direccionGrados: number | null;
}

/** Normaliza la forma de la predicción: rumbo + km/h. */
export function vientoDePrediccion(
  direccion: string | null | undefined,
  velocidadKmh: number | null | undefined,
): VientoNormalizado {
  const rumbo = direccion?.trim().toUpperCase() || null;
  return {
    velocidad: velocidadKmh ?? null,
    direccion: rumbo,
    direccionGrados: gradosDesdeRumbo(rumbo),
  };
}

/** Normaliza la forma de la observación: grados + m/s. */
export function vientoDeObservacion(
  grados: number | null | undefined,
  velocidadMs: number | null | undefined,
): VientoNormalizado {
  const velocidad =
    velocidadMs === null || velocidadMs === undefined ? null : msAKmh(velocidadMs);
  // Viento en calma medido: la dirección en grados no significa nada.
  if (velocidad === 0) {
    return { velocidad: 0, direccion: CALMA, direccionGrados: null };
  }
  return {
    velocidad,
    direccion: rumboDesdeGrados(grados),
    direccionGrados: grados ?? null,
  };
}

/**
 * Texto para los formateadores: "NE a 20 km/h", "en calma".
 *
 * Los grados solo se muestran si se piden, y solo se piden donde son un dato
 * medido (la observación). En la predicción son una conversión del rumbo, y
 * escribir "SO a 15 km/h (225°)" sugiere una precisión que AEMET no dio.
 */
export function textoViento(v: VientoNormalizado, incluirGrados = false): string {
  if (v.velocidad === null) return "—";
  if (v.direccion === CALMA || v.velocidad === 0) return "en calma";
  const rumbo = v.direccion ? `${v.direccion} ` : "";
  const grados =
    incluirGrados && v.direccionGrados !== null ? ` (${v.direccionGrados}°)` : "";
  return `${rumbo}a ${v.velocidad} km/h${grados}`;
}
