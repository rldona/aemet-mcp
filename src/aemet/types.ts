// Tipos de las respuestas de la API OpenData de AEMET.
//
// AEMET no publica un esquema formal estable; estos tipos reflejan la forma real
// observada de las respuestas y se usan con acceso defensivo (campos opcionales)
// porque la API omite claves cuando no hay dato.

/** Respuesta del PRIMER salto: siempre este sobre JSON, nunca los datos. */
export interface AemetEnvelope {
  estado: number;
  descripcion: string;
  /** URL del segundo GET con el contenido real. Ausente si estado != 200. */
  datos?: string;
  /** URL con metadatos del recurso. */
  metadatos?: string;
}

/** Municipio del dataset INE bundleado. */
export interface Municipio {
  /** Código INE de 5 dígitos (CPRO + CMUN). */
  codigo: string;
  nombre: string;
}

// ---------------------------------------------------------------------------
// Predicción específica de municipio (diaria y horaria comparten envoltorio).
// La respuesta es un array con un único elemento.
// ---------------------------------------------------------------------------

export interface PrediccionMunicipio {
  nombre: string;
  provincia: string;
  elaborado: string;
  prediccion: {
    dia: PrediccionDia[];
  };
}

/**
 * Un día de predicción. Los campos varían entre diaria y horaria; se modelan
 * como opcionales y se leen defensivamente en el formateador.
 */
export interface PrediccionDia {
  fecha: string;
  // --- Diaria ---
  temperatura?: { maxima?: number; minima?: number; dato?: DatoHorario[] };
  estadoCielo?: EstadoCielo[];
  probPrecipitacion?: RangoHorario[];
  viento?: VientoDiario[];
  humedadRelativa?: { maxima?: number; minima?: number; dato?: DatoHorario[] };
  // --- Horaria ---
  vientoAndRachaMax?: VientoHorario[];
  precipitacion?: RangoHorario[];
}

export interface EstadoCielo {
  value?: string;
  periodo?: string;
  descripcion?: string;
}

export interface RangoHorario {
  value?: string;
  periodo?: string;
}

export interface VientoDiario {
  direccion?: string;
  velocidad?: number;
  periodo?: string;
}

export interface VientoHorario {
  direccion?: string[];
  velocidad?: string[];
  value?: string;
  periodo?: string;
}

export interface DatoHorario {
  value?: number;
  hora?: number;
}

// ---------------------------------------------------------------------------
// Observación convencional de estación.
// ---------------------------------------------------------------------------

export interface Observacion {
  /** Identificador de estación (idema). */
  idema: string;
  /** Nombre de la estación. */
  ubi?: string;
  /** Fecha/hora del dato (ISO). */
  fint?: string;
  /** Temperatura instantánea (°C). */
  ta?: number;
  /** Humedad relativa (%). */
  hr?: number;
  /** Precipitación acumulada (mm). */
  prec?: number;
  /** Velocidad del viento (m/s). */
  vv?: number;
  /** Dirección del viento (grados). */
  dv?: number;
  /** Presión (hPa). */
  pres?: number;
}

/** Estación del inventario climatológico. */
export interface EstacionInventario {
  indicativo: string;
  nombre: string;
  provincia?: string;
  latitud?: string;
  longitud?: string;
}
