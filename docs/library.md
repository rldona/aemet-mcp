# Uso como librería — referencia

`@rldona/aemet-mcp` es a la vez un **servidor MCP** (bin `aemet-mcp`) y una
**librería** Node/TS. Esta página documenta la API de librería: importar el núcleo
de AEMET en tu propio backend (una web del tiempo, un cron de avisos, un bot…)
**sin pasar por MCP**.

Toda la fontanería difícil de AEMET ya está resuelta: patrón de dos pasos,
codificación inconsistente + reparación de mojibake, caché con TTL, reintentos con
backoff, dataset de municipios del INE, áreas CAP por CCAA y parseo de avisos
(tar + CAP XML).

- **Entry point**: `@rldona/aemet-mcp` → `dist/lib.js` (ESM), tipos en `dist/lib.d.ts`.
- **Node** ≥ 20.19. No arranca ningún servidor MCP al importar la librería.
- **ESM-only**: no se publica build CommonJS. Desde CJS se puede usar `require()`
  igualmente, porque Node ≥ 20.19 soporta `require(esm)`; en Node 18 solo funciona
  el `import()` dinámico.

> ⚠️ **Seguridad**: la API key va **siempre en el servidor** (`AEMET_API_KEY`),
> nunca en el navegador. No expongas la key ni proxies sin control de origen.

## Instalación

```bash
npm i @rldona/aemet-mcp
```

## Quickstart

```ts
import {
  AemetClient,
  resolverMunicipio,
  type PrediccionDiariaMunicipio,
} from "@rldona/aemet-mcp";

const client = new AemetClient({ apiKey: process.env.AEMET_API_KEY! });

const m = resolverMunicipio("Málaga"); // { codigo: "29067", nombre: "Málaga" }
const [pred] = await client.fetchJson<PrediccionDiariaMunicipio[]>(
  `/prediccion/especifica/municipio/diaria/${m.codigo}`,
);
console.log(pred.nombre, pred.prediccion.dia[0]?.temperatura);
```

---

## `AemetClient`

El cliente encapsula el patrón de dos pasos, el encoding, la caché y los reintentos.

### Constructor

```ts
new AemetClient(opts: AemetClientOptions)
```

```ts
interface AemetClientOptions {
  apiKey: string;              // requerido; si falta -> AemetError("MISSING_API_KEY")
  fetchImpl?: typeof fetch;    // inyectable (tests / fetch personalizado). Def: global
  maxRetries?: number;         // presupuesto GLOBAL de reintentos. Def: 3
  backoffBaseMs?: number;      // base del backoff exponencial (ms). Def: 500
  sleep?: (ms: number) => Promise<void>; // inyectable (tests). Def: setTimeout
  timeoutMs?: number;          // timeout por intento (ms). Def: 15000
  maxBytes?: number;           // tope por respuesta. Def: 32 MiB
  allowedHosts?: readonly string[]; // hosts a los que se envía la key. Def: AEMET_HOSTS
  random?: () => number;       // inyectable (tests): jitter. Def: Math.random
  logger?: Logger;             // diagnóstico. Def: el del proceso (stderr)
}
```

**`maxRetries` es un presupuesto global por operación**, compartido por los dos
saltos: `maxRetries: 3` son como mucho 4 peticiones en total, no 4 por salto. Antes
los bucles anidados se multiplicaban y, con timeouts, una operación podía tardar
minutos.

**Timeout.** Cada intento lleva `AbortSignal.timeout(timeoutMs)`, que cubre también
la lectura del cuerpo. Un timeout es reintentable; si se agotan los reintentos, el
error es `TIMEOUT`.

**Reintentos.** Se reintentan timeouts, cortes de red y `5xx` en ambos saltos. Ante
un 429 se respeta la cabecera `Retry-After` (segundos o fecha HTTP), acotada a 30 s;
si no la hay, backoff exponencial con jitter (mitad fija, mitad aleatoria). Los
errores permanentes (`UNSAFE_URL`, `TOO_LARGE`, 401, 404) no se reintentan.

**Caché.** `TtlCache` deduplica cargas en vuelo: N llamadas simultáneas a la misma
clave comparten una promesa en lugar de lanzar N peticiones. Importa poco en el
servidor MCP, donde las llamadas llegan en serie, y mucho al usar el núcleo como
librería desde un backend con concurrencia. Los errores no se cachean.

**Logging.** `AEMET_MCP_LOG` (`silent`/`error`/`warn`/`info`/`debug`, por defecto
`warn`) o un `logger` propio. Todo va a `stderr` y nunca incluye credenciales.

**Hosts autorizados.** El segundo salto va a la URL que AEMET devuelve en `datos`.
Antes de reenviar ahí la cabecera `api_key` se valida que sea HTTPS y de un host de
`AEMET_HOSTS` (`opendata.aemet.es`, `www.aemet.es`), y no se siguen redirecciones.
Se puede sustituir la lista con `allowedHosts`.

### `fetchJson<T>(path, ttlMs?): Promise<T>`

Hace el patrón de dos pasos, **auto-detecta la codificación** (UTF-8 estricto →
latin1), **repara mojibake** y parsea el JSON. Cachea por `path`. `path` es la ruta
relativa a `https://opendata.aemet.es/opendata/api`.

```ts
const [pred] = await client.fetchJson<PrediccionDiariaMunicipio[]>(
  `/prediccion/especifica/municipio/diaria/28079`,
  TTL.prediccion, // opcional; TTL por defecto del cliente si se omite
);
```

### `fetchDatosBytes(path): Promise<Uint8Array>`

Igual que `fetchJson` pero devuelve los **bytes crudos** del segundo salto (para
recursos binarios como el `tar.gz` de avisos). Normalmente usarás `obtenerAvisos`
en su lugar.

### `TTL`

Constantes de TTL recomendadas (ms):

```ts
TTL.prediccion  // 10 min
TTL.observacion //  5 min
TTL.inventario  // 24 h
```

### Rutas de endpoint (cheat-sheet)

| Recurso | Path |
|---------|------|
| Predicción diaria | `/prediccion/especifica/municipio/diaria/{codigoINE}` |
| Predicción horaria | `/prediccion/especifica/municipio/horaria/{codigoINE}` |
| Observación de estación | `/observacion/convencional/datos/estacion/{idema}` |
| Inventario de estaciones | `/valores/climatologicos/inventarioestaciones/todasestaciones` |
| Avisos CAP por área | `/avisos_cap/ultimoelaborado/area/{codigoArea}` (usa `obtenerAvisos`) |

---

## Manejo de errores

Todos los fallos se propagan como `AemetError` (no se inventan datos ni se ocultan).

```ts
import { AemetError } from "@rldona/aemet-mcp";

try {
  await client.fetchJson(`/prediccion/especifica/municipio/diaria/99999`);
} catch (e) {
  if (e instanceof AemetError) {
    console.error(e.code, e.status, e.message);
  }
}
```

`AemetError.code` (`AemetErrorCode`):

| Código | Cuándo | `status` |
|--------|--------|----------|
| `MISSING_API_KEY` | No hay `apiKey` | — |
| `UNAUTHORIZED` | Key inválida | 401 |
| `NOT_FOUND` | Sin datos para el recurso | 404 |
| `RATE_LIMITED` | Límite superado (tras reintentos). Trae `retryAfterMs` si AEMET lo indicó | 429 |
| `UPSTREAM` | Otro estado / 5xx persistente | var. |
| `NETWORK` | Fallo de red tras reintentos | — |
| `TIMEOUT` | Sin respuesta en `timeoutMs`, tras reintentos | — |
| `TOO_LARGE` | La respuesta supera `maxBytes` | — |
| `UNSAFE_URL` | AEMET apuntó a un host/esquema no autorizado, o redirigió | var. |
| `PARSE` | Respuesta no parseable (incluye tar corrupto o truncado) | — |

`describeEstado(estado, descripcion?): string` — mensaje legible para un código de
estado de AEMET.

---

## Municipios

Dataset del INE bundleado (8132 municipios). Resolver **sin llamadas de red**.

```ts
resolverMunicipio(entrada: string): Municipio
// Código INE de 5 díg. o nombre. Lanza si es ambiguo (con las opciones) o no existe.

buscarMunicipios(nombre: string, limit = 15): Municipio[]
// Coincidencias ordenadas: exacta > empieza-por > contiene.

municipioPorCodigo(codigo: string): Municipio | undefined
municipiosDeProvincia(codigoProvincia: string): Municipio[]
esCodigoINE(s: string): boolean          // ¿5 dígitos?
normalize(s: string): string             // minúsculas, sin acentos (para match propio)
totalMunicipios(): number
```

```ts
type Municipio = {
  codigo: string;        // INE, 5 dígitos
  nombre: string;        // forma del INE: "Campello, el"
  nombreNatural: string; // "el Campello"
  provincia: string;
  isla?: string;         // solo Canarias y Baleares
};
```

Ejemplo de autocompletado (endpoint `/api/municipios?q=`):

```ts
const opciones = buscarMunicipios(q, 10); // [{ codigo, nombre, provincia, isla }, ...]
```

### Islas

El INE no tiene concepto de isla y AEMET solo publica por municipio, pero la gente
pregunta por islas. Tabla estática de las 11 de Canarias y Baleares, sin red:

```ts
resolverIsla(entrada: string): Isla | undefined   // "El Hierro", "Ibiza", "gomera"
islaDeMunicipio(codigo: string): Isla | undefined // undefined en la península
municipiosDeIsla(isla: Isla): Municipio[]
islas(): readonly Isla[]
```

`resolverMunicipio` y `buscarMunicipios` la usan solos: un nombre de isla devuelve
sus municipios en vez de coincidencias por subcadena. Ojo con `"Palma"`, que es la
ciudad de Mallorca y **no** la isla de La Palma; para la isla, `"La Palma"`.

### Unidades y fechas

```ts
msAKmh(ms: number): number
rumboDesdeGrados(g: number | null): Rumbo | null   // 92 -> "E"
gradosDesdeRumbo(r: string | null): number | null  // "SO" -> 225; "C" (calma) -> null
vientoDeObservacion(grados, velocidadMs): VientoNormalizado
vientoDePrediccion(rumbo, velocidadKmh): VientoNormalizado

isoConOffset(valor, "UTC" | "Europe/Madrid"): string | null
```

`isoConOffset` uniforma las cuatro convenciones de fecha que mezcla AEMET (sin
zona, `+0000`, `-00:00`, `+02:00`) a ISO 8601 con offset. Solo pone offset a una
fecha desnuda si se le dice en qué zona está: no adivina.

---

## Áreas y avisos

### Áreas (CCAA)

```ts
type Area = { codigo: string; nombre: string; alias?: string[] };

AREAS: Area[]
resolverArea(entrada: string): Area                        // nombre/alias o código de 2 díg.
areaParaMunicipio(codigoMunicipio: string): Area | undefined
```

`areaParaMunicipio` deduce la CCAA a partir de la provincia (2 primeros dígitos del
INE) — útil para dar los avisos de la comunidad de un municipio concreto.

> ⚠️ Los códigos de área **no** siguen el orden intuitivo (van alfabéticos:
> 65 = Canarias, 66 = Cantabria, 78 = Ceuta). Ver
> [aemet-api-notes](./aemet-api-notes.md).

### Avisos

```ts
obtenerAvisos(client, codigoArea, now?): Promise<ResultadoAvisos>
// Descarga el tar.gz, lo descomprime, parsea el CAP y filtra a vigentes. Cacheado.

extraerAvisos(bytes, now, opts?): ResultadoAvisos                // función pura
// opts: { maxBytesDescomprimidos?, maxEntries?, maxTotalBytes? }
// Acota la descompresión (def. 64 MiB) y el tar; los excesos lanzan
// AemetError TOO_LARGE / PARSE.
parseCapAlert(xml: string, now: number): Aviso | null           // un CAP XML -> Aviso
claveAviso(a: Aviso): string   // clave estable para deduplicar (p. ej. notificaciones)
```

```ts
type NivelAviso = "amarillo" | "naranja" | "rojo";
interface Aviso {
  nivel: NivelAviso;
  fenomeno: string;
  zona: string;
  onset?: string;
  expires?: string;
  descripcion?: string;
  probabilidad?: string;
}
interface ResultadoAvisos { avisos: Aviso[]; elaborado?: string }
```

```ts
const { avisos } = await obtenerAvisos(client, resolverArea("Cataluña").codigo);
// avisos ya viene filtrado (no verdes, no expirados) y ordenado por nivel.
```

---

## Estaciones y observación

```ts
pareceIdema(s: string): boolean   // ¿parece un identificador de estación?
resolverEstacion(client, entrada: string): Promise<EstacionResuelta>
// Resuelve idema o nombre contra el inventario (cacheado ~24 h). Lanza si ambiguo.

type EstacionResuelta = { idema: string; nombre: string; provincia?: string };
```

No hay un helper `obtenerObservacion`; se compone con `fetchJson`:

```ts
import { resolverEstacion, formatObservacion, type Observacion } from "@rldona/aemet-mcp";

const est = await resolverEstacion(client, "Madrid, Retiro"); // { idema: "3195", ... }
const registros = await client.fetchJson<Observacion[]>(
  `/observacion/convencional/datos/estacion/${est.idema}`,
  TTL.observacion,
);
const ultimo = registros[registros.length - 1]; // el más reciente
```

`Observacion` es la forma **cruda** de AEMET: `idema`, `ubi`, `fint`, `ta` (temp
°C), `hr` (humedad %), `prec` (mm), `vv` (viento **m/s**), `dv` (dirección °),
`pres` (hPa). Las herramientas MCP la normalizan antes de servirla (viento en km/h,
fechas con offset); si consumes la librería directamente, `vientoDeObservacion` e
`isoConOffset` hacen esa misma conversión.

### Estaciones cercanas

```ts
estacionesCercanas(client, punto, limite = 5): Promise<Array<EstacionResuelta & { distanciaKm: number }>>
distanciaKm(a, b): number   // haversine
```

Muchas estaciones del inventario son solo climatológicas y no publican observación:
hay que probar en orden y quedarse con la primera que responda. Y conviene mirar la
distancia antes de presentar el dato como si fuera del municipio — la más cercana
con datos a Ceuta está en Cádiz, a 29,7 km.

---

## Codificación (mojibake)

Exportados por si consumes AEMET por tu cuenta y necesitas la misma reparación:

```ts
reparaMojibake(text: string): string   // deshace doble codificación "AndÃºjar" -> "Andújar"
reparaProfundo<T>(valor: T): T         // aplica reparaMojibake a cada string de un JSON
```

`fetchJson` ya los aplica internamente; solo los necesitas si haces `fetch` a AEMET
sin el `AemetClient`. Detalle en
[ADR-0012](./adr/0012-codificacion-autodetectada-mojibake.md).

---

## Formateadores

Convierten las respuestas en **texto legible** (resumen + datos), como hace el
servidor MCP. Útiles si quieres el mismo formato en tu backend.

```ts
formatDiaria(pred: PrediccionDiariaMunicipio, dias: DiaDiaria[]): string
formatHoraria(pred: PrediccionHorariaMunicipio, dias: DiaHoraria[]): string
formatObservacion(registros: Observacion[], estacionNombre?: string): string
formatAvisos(ccaa: string, resultado: ResultadoAvisos): string
formatMunicipios(query: string, resultados: Municipio[], isla?: string): string

seleccionarDias<T extends { fecha: string }>(
  dias: T[],
  opciones?: { max?: number; desde?: string; hasta?: string },
): T[]
```

> **Cambio en 0.5.0**: `formatDiaria` y `formatHoraria` reciben los días ya
> seleccionados en vez de un número máximo, para que el texto y los datos
> estructurados no puedan divergir. `seleccionarDias` construye el argumento:
>
> ```ts
> formatDiaria(pred, seleccionarDias(pred.prediccion.dia, { max: 3 }));
> formatDiaria(pred, seleccionarDias(pred.prediccion.dia, { desde: "2026-09-12", hasta: "2026-09-13" }));
> ```

---

## Bajo nivel

```ts
class TtlCache<V> {
  constructor(defaultTtlMs: number, now?: () => number)
  get(key): V | undefined
  set(key, value, ttlMs?): void
  getOrLoad(key, factory: () => Promise<V>, ttlMs?): Promise<V> // no cachea errores
  clear(): void
  get size(): number
}

untar(buf: Uint8Array): TarEntry[]     // TarEntry = { name: string; content: Uint8Array }
```

---

## Tipos exportados

`AemetClientOptions`, `AemetErrorCode`, `Municipio`, `Aviso`, `ZonaAviso`,
`Punto`, `EstacionResuelta`, `NivelAviso`,
`ResultadoAvisos`, `EstacionResuelta`, `TarEntry`, `AemetEnvelope`, `Observacion`,
`EstacionInventario`, `DiaDiaria`, `DiaHoraria`, `PrediccionDiariaMunicipio`,
`PrediccionHorariaMunicipio`, `PrediccionMunicipio`.

---

## Receta: endpoints de una web del tiempo

Ejemplo de handlers (estilo Next.js API routes / cualquier backend) reutilizando la
librería. El cliente se crea **una vez** por proceso (la caché es por instancia).

```ts
import {
  AemetClient, resolverMunicipio, resolverArea, resolverEstacion,
  obtenerAvisos, buscarMunicipios, TTL,
  type PrediccionDiariaMunicipio, type Observacion,
} from "@rldona/aemet-mcp";

const client = new AemetClient({ apiKey: process.env.AEMET_API_KEY! });

// GET /api/municipios?q=malaga
export const buscar = (q: string) => buscarMunicipios(q, 10);

// GET /api/prediccion/diaria?municipio=Madrid
export async function prediccionDiaria(municipio: string) {
  const m = resolverMunicipio(municipio);
  const [pred] = await client.fetchJson<PrediccionDiariaMunicipio[]>(
    `/prediccion/especifica/municipio/diaria/${m.codigo}`, TTL.prediccion,
  );
  return pred;
}

// GET /api/avisos?ccaa=Andalucia
export async function avisos(ccaa: string) {
  return obtenerAvisos(client, resolverArea(ccaa).codigo);
}

// GET /api/observacion?estacion=3195
export async function observacion(estacion: string) {
  const est = await resolverEstacion(client, estacion);
  const registros = await client.fetchJson<Observacion[]>(
    `/observacion/convencional/datos/estacion/${est.idema}`, TTL.observacion,
  );
  return { estacion: est, ultima: registros.at(-1) };
}
```

**Buenas prácticas**

- Crea el `AemetClient` **una vez** (módulo singleton): la caché en memoria es por
  instancia y evita repetir peticiones a AEMET dentro del TTL.
- Deja que los `AemetError` suban y tradúcelos a códigos HTTP en tu capa (401→401,
  404→404, 429→429/503…). **No** devuelvas datos por defecto ante un fallo.
- Respeta los límites de AEMET: la caché + los reintentos con backoff ya ayudan;
  no elimines el TTL.
- CORS solo para tu dominio; la key nunca sale del backend.

---

Ver también: [arquitectura](./architecture.md) · [notas de la API de AEMET](./aemet-api-notes.md) · [ADRs](./adr/README.md).
