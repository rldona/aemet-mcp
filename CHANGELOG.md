# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

_Nada por ahora._

## [0.3.0] - 2026-09-07

Resolución formal de la compatibilidad ESM/CommonJS (ticket 9 de
`docs/backlog-mejoras.md`).

### Cambiado — INCOMPATIBLE

- **Node ≥ 20.19** (antes ≥ 18). El paquete se declara formalmente **ESM-only**:
  se publica un único build ES module y no hay build CommonJS.

  20.19 no es un número arbitrario: es la primera versión con `require(esm)`, que
  es justo lo que permite consumir un paquete ESM-only desde CommonJS. Con ese
  suelo, `import` y `require()` funcionan los dos; por debajo, `require()` falla
  con `ERR_REQUIRE_ESM` (comprobado: en Node 18.20.8 el `import()` dinámico
  funciona y el `require()` no).

  Quien siga en Node 18 puede quedarse en la 0.2.x o usar `import()` dinámico.

- La condición `exports` pasa a ser explícita (`types` / `import` / `require`, las
  tres al mismo fichero ESM), sustituyendo a la condición `default` que se añadió
  en la 0.2.1. Aquella no arreglaba nada **en el suelo que el paquete declaraba
  entonces**: con `engines: >=18`, `require()` fallaba igual. Ahora la resolución
  es explícita y el suelo la respalda.

- Target del build: `node18` → `node20`.
- Matriz de CI: Node 18/20/22 → 20.19/22/24.

### Añadido

- **`npm run test:pack`**: valida el artefacto publicable, no el árbol de trabajo.
  Empaqueta con `npm pack`, instala el tarball en un proyecto limpio fuera del
  repo y comprueba resolución `import`/`require`, que las exportaciones públicas
  siguen ahí, que los tipos resuelven bajo `moduleResolution: NodeNext`, el bit de
  ejecución y el shebang del binario, el handshake MCP contra el paquete instalado
  y que no se cuele en el tarball nada que no toque (`.env`, `.npmrc`, `src/`,
  `test/`).

  Cubre justo el hueco entre los tests y la publicación: nada de lo que valida se
  puede romper de una forma que un test unitario detecte.

- CI ejecuta esa validación en un job `package` sobre toda la matriz (20.19/22/24),
  porque la resolución de módulos cambia entre versiones de Node. El workflow de
  publicación la ejecuta como último paso antes de `npm publish`.

- **`tsconfig.test.json`**: los tests entran en el typecheck. `tsconfig.json` los
  excluye a propósito (describe lo que se compila y publica), así que hasta ahora
  solo los veía el transpilador de vitest, que borra los tipos sin comprobarlos.
  `npm run typecheck` cubre ahora código productivo y tests. Ojo al heredar: el
  `exclude` del fichero base contiene `"test"` y hay que reescribirlo entero, o la
  configuración no comprueba ningún test y pasa siempre.

- **`npm run audit:prod`** (`npm audit --omit=dev --audit-level=high`) y job
  `audit` en CI, que falla ante vulnerabilidades altas o críticas en dependencias
  de producción. El criterio, el porqué del umbral y la vía de excepción quedan
  documentados en `SECURITY.md`.

- `probPrecipitacionDia` y `observacionMasReciente` pasan a formar parte de la API
  pública de la librería.

### Verificado

- **La agregación de la predicción diaria no estaba mal.** El ticket la daba por
  rota; con payloads reales de Madrid, A Coruña y Sevilla no se reproduce. AEMET
  devuelve dos formas: los días 0-3 traen siempre el agregado `00-24` junto a los
  subperiodos, y los días 4-6 traen un único elemento **sin** campo `periodo` que
  ya es el día entero. El fallback al primer elemento solo se activa en el segundo
  caso, donde es correcto por ser el único. Estructura documentada en
  `docs/aemet-api-notes.md` y fijada con fixtures de regresión.

  Sí se ha endurecido el único caso que sería silenciosamente erróneo si AEMET lo
  introdujera —varios subperiodos y ningún `00-24`—: la probabilidad de lluvia del
  día pasa a ser el máximo en vez del primero, que presentaría la madrugada como
  el día entero.

### Corregido

- El workflow de publicación ejecutaba `npm test` **antes** de `npm run build`, lo
  que con el smoke test MCP añadido en la 0.2.2 habría roto toda publicación.

- **La observación más reciente se elige comparando `fint`**, no cogiendo el último
  elemento del array. AEMET lo devuelve en orden cronológico, así que funcionaba,
  pero era una suposición sobre el proveedor que habría fallado en silencio dando
  un dato viejo por actual. Los registros sin fecha o con fecha ilegible no
  compiten; si ninguno la trae, se conserva el criterio anterior.

- **`RangoHorario.value` puede ser número.** AEMET manda la probabilidad de
  precipitación como cadena en los días 0-3 y como número en los 4-6; el tipo
  decía `string`.

## [0.2.2] - 2026-09-07

Entrega de robustez del cliente HTTP (tickets 1-8 de `docs/backlog-mejoras.md`).
Sin cambios incompatibles en la API pública.

### Seguridad

- **La API key ya no puede salir de los hosts de AEMET.** El segundo salto va a la
  URL que AEMET devuelve en `datos`, que la dicta el servidor. Ahora se valida
  antes de adjuntar la cabecera `api_key`: solo HTTPS y solo `opendata.aemet.es` o
  `www.aemet.es` (configurable con `allowedHosts`). Nueva función pública
  `validarUrlDatos` y constante `AEMET_HOSTS`.
- **No se siguen redirecciones** (`redirect: "manual"`): `fetch` no elimina las
  cabeceras propias al cruzar de origen —solo `Authorization` y `Cookie`—, así que
  un `Location` externo habría filtrado la key. Un 3xx produce `UNSAFE_URL`.
- **Tope de tamaño por respuesta** (`maxBytes`, 32 MiB por defecto). Se comprueba
  primero `Content-Length` y, si el cuerpo llega por stream, se corta en cuanto se
  supera, sin materializar la respuesta entera. Nuevo error `TOO_LARGE`.
- **Descompresión acotada**: `gunzipSync` deja de poder expandir sin límite y el
  extractor tar aplica topes de entradas y de bytes extraídos.
- Fijadas por `overrides` las versiones parcheadas de cinco dependencias
  transitivas del SDK MCP (`ip-address`, `hono`, `@hono/node-server`, `qs`,
  `fast-uri`). `npm audit --omit=dev` pasa de 2 altas y 3 moderadas a cero.

### Añadido

- **Timeout por intento** (`timeoutMs`, 15 s por defecto) mediante
  `AbortSignal.timeout`, que cubre también la lectura del cuerpo. Nuevo error
  `TIMEOUT`. Antes no había ningún timeout y un socket colgado dejaba el servidor
  MCP esperando indefinidamente, bloqueando el turno del agente.
- `Retry-After` se respeta ante un 429 (segundos o fecha HTTP), acotado a 30 s.
- Jitter en el backoff exponencial (mitad fija, mitad aleatoria), con `random`
  inyectable para tests.
- Los `5xx` transitorios se reintentan también en el primer salto.
- Nuevas opciones de `AemetClientOptions`: `timeoutMs`, `maxBytes`,
  `allowedHosts`, `random`.
- Nuevas exportaciones: `validarUrlDatos`, `AEMET_HOSTS`, `DEFAULT_TIMEOUT_MS`,
  `DEFAULT_MAX_BYTES`, `readOctal`, `UntarOptions`, `DEFAULT_MAX_ENTRIES`,
  `DEFAULT_MAX_TOTAL_BYTES`.
- **Smoke test del servidor MCP**: arranca `dist/index.js`, completa el handshake
  por stdio, comprueba el inventario de herramientas y su versión. `src/index.ts`
  no tenía ninguna cobertura. En CI el build pasa a ejecutarse antes de los tests.

### Cambiado

- **`maxRetries` es ahora un presupuesto global por operación**, compartido por los
  dos saltos. Los bucles anidados (reintentos HTTP dentro de reintentos por 429) se
  multiplicaban: con `maxRetries: 3` el peor caso eran 16 peticiones y, sumando
  timeouts, minutos de bloqueo. Ahora `maxRetries: 3` son como mucho 4 peticiones.
- El cuerpo de la respuesta se lee dentro del intento con timeout y reintentos, no
  después: un corte a mitad de descarga ahora se reintenta.

### Corregido

- **El extractor tar ya no acepta archivos truncados ni cabeceras corruptas.**
  Validaba que la cabecera cupiera en el buffer, pero no el contenido: una entrada
  que declaraba más bytes de los que quedaban devolvía un `subarray` corto y el
  fallo aparecía más tarde, al parsear el CAP. Además `readOctal` devolvía `0`
  tanto para un campo vacío como para uno corrupto, con lo que una cabecera basura
  se leía como fichero de tamaño cero y el recorrido seguía desalineado. Ahora
  ambos casos lanzan `PARSE` con un mensaje explícito, y la codificación GNU
  base-256 se declara no soportada en vez de leerse mal.
- **La versión anunciada por MCP se inyecta en build desde `package.json`.** Estaba
  escrita a mano en `src/index.ts` y ya había divergido; un test lo impide ahora.

## [0.2.1] - 2026-07-19

### Corregido

- **Packaging**: se añade la condición `default` a `exports` (además de `import`),
  para que los consumidores que resuelven en CommonJS (ts-node, jest en CJS, `tsx`
  en proyectos sin `"type": "module"`) no fallen con `ERR_PACKAGE_PATH_NOT_EXPORTED`
  al hacer `require()` del paquete. La resolución ESM ya funcionaba.

## [0.2.0] - 2026-07-19

### Añadido

- **API de librería**: el paquete ahora es importable (`import { AemetClient, … }
  from "@rldona/aemet-mcp"`) además de ejecutable como servidor MCP. Expone el
  cliente de dos pasos, municipios (búsqueda/resolución), áreas CAP, avisos
  (tar + CAP XML), estaciones, formateadores y tipos. Entrada `src/lib.ts`,
  con declaraciones de tipos (`dist/lib.d.ts`).
- `areaParaMunicipio(codigoINE)`: resuelve el área de avisos CAP (CCAA) a partir
  del código INE de un municipio (mapa provincia → área).
- `claveAviso(aviso)`: clave estable de un aviso para deduplicación.

### Corregido

- **Acentos rotos (mojibake) en respuestas de AEMET**: el servidor de datos
  devuelve codificaciones distintas según el nodo que responda (a veces UTF-8,
  a veces doblemente codificado, siempre declarando `charset=ISO-8859-15`).
  Ahora se decodifica con auto-detección (UTF-8 estricto con fallback latin1)
  y se repara el mojibake cadena a cadena tras el `JSON.parse`
  (`reparaMojibake`/`reparaProfundo`). Descubierto en producción en notemojes.com
  ("AndÃºjar" → "Andújar").
- El `fetch` global se resuelve en cada llamada en lugar de capturarse en el
  constructor (evita quedarse con un `fetch` parcheado obsoleto en runtimes
  que lo instrumentan, como Next.js).

## [0.1.2] - 2026-07-19

### Añadido

- `prediccion_diaria` muestra la **racha máxima de viento** (km/h) junto al viento,
  cuando AEMET la proporciona.

### Cambiado

- Las publicaciones incluyen **provenance** (`npm publish --provenance`); la 0.1.1
  se publicó sin atestación por un flag omitido.

## [0.1.1] - 2026-07-19

### Añadido

- `prediccion_diaria` ahora incluye la **humedad relativa** (máxima/mínima) de cada
  día, que AEMET ya proporcionaba y no se mostraba.

### Cambiado

- Publicación mediante **Trusted Publishing (OIDC)** desde GitHub Actions, sin
  `NPM_TOKEN` y con provenance automática (ver
  [ADR-0011](./docs/adr/0011-trusted-publishing-oidc.md)).

## [0.1.0] - 2026-07-19

Primera versión pública. Servidor MCP completo para el tiempo oficial de España
vía la API OpenData de AEMET, con 5 herramientas verificadas contra la API real.

### Añadido

- **Servidor MCP por stdio** (`@modelcontextprotocol/sdk`), enchufable a Claude
  Desktop, Cursor y cualquier cliente MCP sin adaptadores.
- **`buscar_municipio`** — resuelve nombre → código INE de 5 dígitos con match
  tolerante a acentos y mayúsculas; desambigua nombres repetidos.
- **`prediccion_diaria`** — predicción diaria (1-7 días): máx/mín, estado del
  cielo, probabilidad de precipitación y viento.
- **`prediccion_horaria`** — predicción hora a hora del día en curso y siguiente.
- **`observacion_estacion`** — última observación convencional de una estación
  (temperatura, humedad, viento, precipitación, presión); resuelve idema o nombre
  vía el inventario de estaciones.
- **`avisos`** — avisos meteorológicos vigentes por comunidad autónoma, parseados
  del formato CAP (tar.gz de XML) sin dependencias externas.
- **Cliente AEMET** (`AemetClient`) que encapsula el patrón de dos pasos de la API,
  decodifica latin1 (datos y sobres de error), mapea los estados `200/401/404/429`
  a errores tipados y reintenta con backoff ante `429`, fallos de red y `5xx`
  transitorios.
- **Dataset de 8132 municipios** del padrón oficial del INE, bundleado en el
  paquete (sin llamadas extra para resolver nombres).
- **Caché en memoria con TTL**: ~10 min predicción/avisos, ~5 min observación,
  24 h inventario de estaciones.
- **Suite de tests** con Vitest (38 tests: unitarios con `fetch` mockeado +
  integración real contra AEMET, esta última guardada por `AEMET_API_KEY`).
- **CI en GitHub Actions** (Node 18/20/22) y workflow de publicación con provenance.
- Documentación: README, especificación, documentación funcional y técnica, y
  registros de decisiones de arquitectura (ADR).

### Notas

- Publicado como paquete con scope **`@rldona/aemet-mcp`** (el nombre `aemet-mcp`
  sin scope ya estaba ocupado en npm por otro autor).
- No se inventan ni mockean datos en producción: si un endpoint de AEMET falla, el
  error se propaga de forma clara.

[No publicado]: https://github.com/rldona/aemet-mcp/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/rldona/aemet-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rldona/aemet-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/rldona/aemet-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rldona/aemet-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rldona/aemet-mcp/releases/tag/v0.1.0
