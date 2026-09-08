// API pública de @rldona/aemet-mcp como LIBRERÍA.
//
// El paquete nació como servidor MCP por stdio (bin `aemet-mcp`), pero su núcleo
// resuelve toda la fontanería difícil de AEMET OpenData y es reutilizable desde
// cualquier backend Node/TS (p. ej. notemojes.com): patrón de dos pasos,
// codificación inconsistente (con reparación de mojibake), caché TTL, reintentos
// con backoff, dataset de municipios del INE, áreas CAP por CCAA y parseo de
// avisos (tar + CAP XML). Esta entrada NO arranca ningún servidor MCP.

export {
  AEMET_HOSTS,
  AemetClient,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  TTL,
  reparaMojibake,
  reparaProfundo,
  validarUrlDatos,
  type AemetClientOptions,
} from "./aemet/client.js";

export { AemetError, describeEstado, type AemetErrorCode } from "./aemet/errors.js";

export { TtlCache } from "./aemet/cache.js";

export {
  crearLogger,
  log,
  nivelDesdeEntorno,
  urlSegura,
  type Campos,
  type Logger,
  type NivelLog,
} from "./aemet/log.js";

export {
  buscarMunicipios,
  esCodigoINE,
  etiquetaMunicipio,
  municipioPorCodigo,
  municipiosDeIsla,
  municipiosDeProvincia,
  nombreNatural,
  normalize,
  resolverMunicipio,
  totalMunicipios,
  variantesNombre,
} from "./aemet/municipios.js";

export {
  PROVINCIAS,
  codigoProvincia,
  provinciaPorCodigo,
} from "./aemet/provincias.js";

export { AREAS, areaParaMunicipio, resolverArea } from "./aemet/areas.js";

export { notaNombreCompartido } from "./aemet/homonimos.js";

export {
  PROVINCIAS_INSULARES,
  islaDeMunicipio,
  islas,
  resolverIsla,
  type Isla,
} from "./aemet/islas.js";

export { isoConOffset, type ZonaSupuesta } from "./aemet/fechas.js";

export {
  CALMA,
  RUMBOS,
  gradosDesdeRumbo,
  msAKmh,
  rumboDesdeGrados,
  textoViento,
  vientoDeObservacion,
  vientoDePrediccion,
  type Rumbo,
  type VientoNormalizado,
} from "./aemet/viento.js";

export {
  DEFAULT_MAX_DESCOMPRIMIDO,
  avisosParaPunto,
  claveAviso,
  extraerAvisos,
  obtenerAvisos,
  parseCapAlert,
  type Aviso,
  type ExtraerAvisosOptions,
  type NivelAviso,
  type ResultadoAvisos,
  type ZonaAviso,
} from "./aemet/avisos.js";

export {
  coordenadasMunicipio,
  parsePoligono,
  puntoEnPoligono,
  type Punto,
} from "./aemet/geo.js";

export {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_TOTAL_BYTES,
  readOctal,
  untar,
  type TarEntry,
  type UntarOptions,
} from "./aemet/tar.js";

export {
  buscarEstaciones,
  distanciaKm,
  estacionesCercanas,
  inventarioEstaciones,
  pareceIdema,
  parseCoordenadaDMS,
  resolverEstacion,
  type EstacionResuelta,
} from "./aemet/estaciones.js";

export {
  formatAvisos,
  formatAvisosMunicipio,
  formatDiaria,
  formatEstaciones,
  formatHoraria,
  formatMunicipios,
  formatObservacion,
  formatObservacionMunicipio,
  observacionMasReciente,
  pickPeriodo,
  probPrecipitacionDia,
  seleccionarDias,
} from "./aemet/format.js";

export type {
  AemetEnvelope,
  DiaDiaria,
  DiaHoraria,
  EstacionInventario,
  Municipio,
  Observacion,
  PrediccionDiariaMunicipio,
  PrediccionHorariaMunicipio,
  PrediccionMunicipio,
} from "./aemet/types.js";
