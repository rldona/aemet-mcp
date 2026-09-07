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
  buscarMunicipios,
  esCodigoINE,
  municipioPorCodigo,
  normalize,
  resolverMunicipio,
  totalMunicipios,
} from "./aemet/municipios.js";

export { AREAS, areaParaMunicipio, resolverArea } from "./aemet/areas.js";

export {
  DEFAULT_MAX_DESCOMPRIMIDO,
  claveAviso,
  extraerAvisos,
  obtenerAvisos,
  parseCapAlert,
  type Aviso,
  type ExtraerAvisosOptions,
  type NivelAviso,
  type ResultadoAvisos,
} from "./aemet/avisos.js";

export {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_TOTAL_BYTES,
  readOctal,
  untar,
  type TarEntry,
  type UntarOptions,
} from "./aemet/tar.js";

export {
  pareceIdema,
  resolverEstacion,
  type EstacionResuelta,
} from "./aemet/estaciones.js";

export {
  formatAvisos,
  formatDiaria,
  formatHoraria,
  formatMunicipios,
  formatObservacion,
  observacionMasReciente,
  probPrecipitacionDia,
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
