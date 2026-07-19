# Backlog priorizado de mejoras

Este documento recoge las mejoras funcionales y técnicas identificadas tras revisar
el proyecto. Es una revisión de la auditoría inicial, contrastada ticket a ticket
contra el código en el commit `6d6593c` (v0.2.1): se han recalibrado prioridades,
corregido diagnósticos que no se sostenían al leer el código, añadido lo que
faltaba y apartado lo que no compensa hoy.

La columna **ID** conserva la numeración de la auditoría original (`A1`…`A34`) para
poder cruzarla; la columna **#** es el orden de ejecución recomendado. Los tickets
nuevos llevan prefijo `N`.

## Contexto y modelo de amenazas

La calibración de prioridades depende de qué es este proyecto, y conviene dejarlo
escrito porque la auditoría original priorizó como si fuera un servicio expuesto:

- Es un **servidor MCP stdio** de ~1.500 líneas, ejecutado localmente por el
  cliente MCP del usuario. No escucha en ningún puerto ni atiende peticiones de
  terceros.
- Habla con **un único origen**: la API pública OpenData de AEMET, sobre HTTPS.
- El secreto a proteger es **una API key gratuita de AEMET**, obtenible por
  cualquiera en un formulario. Su fuga es molesta, no crítica.
- Se distribuye además **como librería** (`src/lib.ts`), y ahí sí puede ejecutarse
  en un backend con concurrencia real. Varios tickets solo tienen sentido por
  este segundo uso, y se marcan como tales.

En consecuencia, **P0 queda reservado a lo que bloquea al usuario**: un servidor
MCP que no responde deja colgado el turno del agente, sin timeout ni mensaje. Los
escenarios que exigen que AEMET esté comprometido, o un MITM sobre TLS, son
defensa en profundidad legítima y barata, pero son P1.

## Niveles de prioridad

- **P0 — Crítica**: bloquea al usuario o rompe el servidor en uso normal.
- **P1 — Alta**: fiabilidad, defensa en profundidad y funcionalidad con impacto directo.
- **P2 — Media**: calidad, mantenibilidad y experiencia de desarrollo.
- **P3 — Baja**: ampliaciones futuras.

## Hallazgos que cambian el ticket

Cuatro puntos donde leer el código altera lo que el ticket debe hacer:

1. **El arreglo de CommonJS publicado en la v0.2.1 no arregla nada** (`A5`). El
   commit `6d6593c` añadió la condición `"default": "./dist/lib.js"` a `exports`
   para "resolución CJS", pero ese fichero es ESM dentro de un paquete
   `"type": "module"`: en Node 18 —declarado en `engines`— `require()` sigue
   lanzando `ERR_REQUIRE_ESM`. Hay un fix publicado que no funciona. Esto sube el
   ticket a la primera mitad del backlog. A favor: el README no promete CJS, así
   que no hay documentación que rectificar.

   *Matiz tras resolverlo*: el problema era la combinación, no la condición. A
   partir de Node 20.19 existe `require(esm)`, así que sobre ese suelo la
   resolución sí habría funcionado; lo que la invalidaba era el `engines: >=18`
   que el propio paquete declaraba. Comprobado en Node 18.20.8 (`import()` sí,
   `require()` no) y en 20.19.6 (ambos sí). Resuelto declarando el paquete
   ESM-only con `engines: >=20.19`.
2. **El diagnóstico de la agregación diaria es impreciso** (`A11`). `pickPeriodo`
   en `src/aemet/format.ts` busca `"00-24"` primero y solo cae a `arr[0]` si no
   existe; en los días 0-2 AEMET sí devuelve `00-24`. El ticket se reconvierte en
   un spike: capturar un payload real y comprobar cuándo falla de verdad antes de
   tocar código.

   *Resultado del spike*: **el fallo no se reproduce**. Con payloads reales de
   Madrid, A Coruña y Sevilla, los días 0-3 traen siempre `00-24` y los días 4-6
   traen un único elemento **sin** campo `periodo`, que ya es el día entero. El
   fallback a `arr[0]` solo se activa en el segundo caso, donde es correcto por
   ser el único elemento: no hay ningún escenario en que se presente un
   subperiodo como el día. Estructura documentada en `docs/aemet-api-notes.md`.
   El ticket se cierra con fixtures de regresión, un endurecimiento defensivo del
   agregado de lluvia y una corrección de tipos (`value` puede ser número).
3. **Añadir provincia es mucho más barato de lo estimado** (`A8`). Los dos
   primeros dígitos del código INE *son* el código de provincia: basta una tabla
   de 52 entradas y derivarla, sin regenerar `src/data/municipios.json` ni tocar
   el pipeline de datos.
4. **Las vulnerabilidades de producción son reales pero inertes** (`A1`).
   `npm audit --omit=dev` reporta 2 *high* y 3 *moderate* (`ip-address`, `hono`,
   `qs`), todas transitivas de `@modelcontextprotocol/sdk` 1.29 y todas colgando
   de los transportes HTTP del SDK, que este servidor no usa (solo stdio). Impacto
   real prácticamente nulo, así que no justifica ser el ticket número 1.

   *Corrección tras ejecutarlo*: subir el SDK **no** basta. La 1.30, que es la
   última, sigue trayendo `express`, `hono` y `express-rate-limit` como
   dependencias directas con las mismas versiones vulnerables, y al taparlas
   afloran dos más (`@hono/node-server`, `fast-uri`). Hizo falta fijar las cinco
   por `overrides` en `package.json`.

## Tickets

Las filas marcadas con ✅ están entregadas: **v0.2.2** completa (tickets 1-8) y
**v0.3.0** completa (tickets 9-14), todo el 2026-09-07.


| # | ID | Ticket | Prioridad | Tipo | Est. | Depende de | Criterios de aceptación |
|--:|----|--------|:---------:|------|:----:|------------|-------------------------|
| 1 | A2 | ✅ Añadir timeout configurable a las peticiones AEMET | P0 | Fiabilidad | M | — | Ambos saltos HTTP tienen timeout mediante `AbortSignal`; existe un error `TIMEOUT`; el timeout es configurable en `AemetClientOptions`; un timeout cuenta como intento reintentable (hoy `doFetch` solo captura rechazos, así que un socket colgado no reintenta ni falla nunca); hay pruebas de timeout y de cancelación con `fetchImpl` y `sleep` inyectados. |
| 2 | A3 | ✅ Validar las URL de datos antes de enviar la API key | P1 | Seguridad | S | 1 | Solo se aceptan URL `https:` sobre hosts de AEMET (`opendata.aemet.es`, `www.aemet.es`) antes de reenviar la cabecera `api_key` en `fetchBytes`; se usa `redirect: "manual"` y se rechaza cualquier redirección, dado que `fetch` no elimina cabeceras propias al cruzar de origen (solo `Authorization`/`Cookie`); la lista es configurable; hay tests con URL de `datos` apuntando fuera de AEMET. |
| 3 | A4 | ✅ Limitar el tamaño de descarga y descompresión | P1 | Seguridad | S | 1 | Hay tope configurable de bytes al descargar el fichero de datos; `gunzipSync` se llama con `maxOutputLength`; los excesos producen errores explícitos y no un `OOM`; hay una prueba de respuesta sobredimensionada. Alcance recortado respecto a `A4`: el conteo de ficheros y el tamaño por XML se cubren en el ticket 5. |
| 4 | A7 | ✅ Mejorar los reintentos HTTP de AEMET | P2 | Fiabilidad | S | 1 | Se respeta la cabecera `Retry-After` ante 429; el backoff exponencial lleva jitter; los 5xx transitorios se reintentan también en el primer salto (hoy solo en el segundo); los errores permanentes no se reintentan; pruebas deterministas con `sleep` inyectado. Bajado de P1: el 429 ya se reintenta con backoff, esto es afinado, no una carencia. |
| 5 | N1 | ✅ Endurecer el extractor tar | P1 | Fiabilidad | S | — | `untar` valida que el offset y el tamaño declarado caben en el buffer y aborta ante un tar truncado en lugar de devolver `subarray` cortos; `readOctal` distingue "campo vacío" de "campo corrupto" en vez de devolver `0` en ambos casos; hay tope de número de entradas; pruebas con tar truncado y con cabecera corrupta. Extraído de `A4`/`A17` porque es el único de los tres que es explotable sin comprometer AEMET. |
| 6 | A1 | ✅ Actualizar dependencias de producción | P1 | Seguridad | S | — | `@modelcontextprotocol/sdk` a 1.30 y lockfile actualizado; las transitivas vulnerables que el SDK sigue arrastrando (`ip-address`, `hono`, `@hono/node-server`, `qs`, `fast-uri`) quedan fijadas a su versión parcheada mediante `overrides`, documentando que son de los transportes HTTP que este servidor no usa; `npm audit --omit=dev` sin vulnerabilidades altas ni críticas; pasan tests, typecheck y build en Node 18, 20 y 22. |
| 7 | N2 | ✅ Smoke test del arranque y el handshake MCP | P1 | Testing | S | — | Un test lanza `dist/index.js` como proceso hijo, completa el handshake MCP por stdio y verifica que se registran las 5 herramientas esperadas con sus nombres; falla si el servidor no arranca o si cambia el inventario de tools sin actualizar el test. Hoy `src/index.ts` no tiene ninguna cobertura: ningún test arranca el servidor. Adelantado desde `A18` porque son ~30 líneas y cubren el riesgo de regresión más caro del proyecto. |
| 8 | A24 | ✅ Eliminar la versión duplicada del servidor MCP | P2 | Mantenimiento | S | 7 | La versión anunciada en `src/index.ts` deja de estar escrita a mano (hoy `"0.2.1"` literal) y se inyecta en build con `define` de tsup o se lee de `package.json`; el smoke test del ticket 7 comprueba que coincide con la versión publicada. |
| 9 | A5 | ✅ Resolver formalmente la compatibilidad ESM/CommonJS | P1 | Packaging | M | — | Se elige una de las dos salidas y se ejecuta entera: (a) build CJS real con `format: ["esm","cjs"]` en tsup y condición `require` apuntando al `.cjs`, o (b) paquete declarado ESM-only, `engines` subido a `>=20.19` y documentado. En ambos casos se elimina la condición `"default"` actual, que hoy induce a error; el tarball se prueba con `import()` y `require()` en todas las versiones de Node soportadas. |
| 10 | A21 | ✅ Probar el paquete npm empaquetado en CI | P2 | CI/Packaging | M | 9 | CI ejecuta `npm pack`, instala el tarball en un proyecto temporal y valida binario, imports públicos, tipos, permisos de ejecución y arranque MCP. |
| 11 | A19 | ✅ Incluir los tests en el typecheck | P2 | Testing | S | — | Existe una configuración TypeScript que cubre `test/` (hoy `tsconfig.json` lo excluye explícitamente); CI comprueba código productivo y tests; se eliminan los casts incorrectos que aparezcan. |
| 12 | A22 | ✅ Añadir auditoría de dependencias a CI | P2 | CI/Seguridad | S | 6 | La CI falla ante vulnerabilidades altas o críticas de producción; el criterio y las excepciones quedan documentados. |
| 13 | A15 | ✅ Seleccionar explícitamente la observación más reciente | P2 | Corrección | S | — | `formatObservacion` deja de asumir que el último elemento del array es el más reciente y compara `fint`; las fechas ausentes o inválidas se gestionan explícitamente; hay prueba con registros desordenados. Bajado de P1: AEMET devuelve orden cronológico, es fragilidad, no un fallo observado. |
| 14 | A11 | ✅ Verificar y corregir la agregación de la predicción diaria | P1 | Funcional | S→M | — | **Primero un spike**: capturar payloads reales de días 0-2 y 4-7 y documentar qué periodos devuelve AEMET en cada campo. Si se confirma el fallo, la lluvia usa el máximo del día, cielo y viento dejan de depender de `arr[0]`, y se distinguen mañana/tarde/noche cuando no existe `00-24`; en cualquier caso se añaden fixtures con múltiples periodos. La estimación sube a M solo si el spike confirma el problema. |
| 15 | A8 | Añadir provincia al dataset y resultados de municipios | P1 | Funcional | S | — | Cada municipio expone provincia, derivada de los dos primeros dígitos del código INE mediante una tabla de 52 entradas; no se regenera `municipios.json`; los nombres duplicados se desambiguan mostrando provincia y código INE; se actualizan tipos, formatos y documentación. |
| 16 | A9 | Soportar nombres naturales y artículos invertidos de municipios | P1 | Funcional | M | 15 | Consultas como "El Campello", "A Coruña" y "La Zarza" encuentran los municipios esperados; se preserva la resolución de los nombres actuales; hay pruebas de regresión. |
| 17 | A10 | Incorporar salidas MCP estructuradas | P1 | MCP/API | L | 15 | Las herramientas declaran `outputSchema` y devuelven `structuredContent`; conservan el texto actual por compatibilidad; fechas, códigos y valores meteorológicos quedan tipados. |
| 18 | A12 | Añadir la herramienta `buscar_estacion` | P1 | Funcional | S | 17 | Permite buscar estaciones por nombre, provincia o idema; devuelve coordenadas y candidatos estructurados; gestiona con claridad las ambigüedades. Estimación bajada a S: `resolverEstacion` en `src/aemet/estaciones.ts` ya resuelve la mayor parte y el inventario ya trae latitud y longitud; el ticket es exponer lo que existe. |
| 19 | A13 | Añadir observación por municipio y estación más cercana | P1 | Funcional | L | 15, 18 | Resuelve un municipio, calcula estaciones próximas y obtiene la observación más adecuada; muestra distancia y hora del dato; permite elegir otra estación. |
| 20 | A14 | Añadir avisos meteorológicos por municipio | P1 | Funcional | M | 15, 17 | Acepta nombre o código INE; resuelve automáticamente el área CAP; identifica con claridad el alcance territorial; evita avisos irrelevantes cuando sea posible. |
| 21 | A18 | Ampliar las pruebas del contrato MCP | P2 | Testing | M | 17 | Sobre la base del ticket 7, se cubren schemas de entrada y salida, invocación, errores y `structuredContent` de cada herramienta. Estimación bajada de L a M porque el handshake ya está cubierto. |
| 22 | A6 | Evitar peticiones concurrentes duplicadas en caché | P2 | Rendimiento | S | — | `TtlCache.getOrLoad` comparte una única promesa entre cargas simultáneas de la misma clave; un error elimina la operación en vuelo; hay pruebas de concurrencia. Bajado de P1: irrelevante en el servidor stdio, donde las llamadas llegan en serie; solo aplica al uso como librería desde un backend. |
| 23 | A27 | Añadir logging diagnóstico configurable a `stderr` | P2 | Operabilidad | M | — | Hay niveles configurables y métricas de duración, reintentos y cache hit/miss; nunca se escribe en `stdout` ni se registran API keys ni respuestas sensibles. |
| 24 | A23 | Automatizar actualizaciones con Dependabot o Renovate | P2 | Mantenimiento | S | 6 | La configuración queda versionada; las actualizaciones se agrupan razonablemente; GitHub Actions y npm se revisan periódicamente. |
| 25 | A28 | Fijar y endurecer la cadena de publicación | P2 | Supply chain | M | 6 | Las GitHub Actions están fijadas por SHA; la versión de npm está controlada; OIDC y provenance se mantienen; el workflow es reproducible. |
| 26 | A25 | Automatizar la actualización anual del dataset INE | P2 | Datos | M | 15 | Existe un workflow manual o programado; valida fuente, cantidad, duplicados, códigos, altas y bajas; genera un diff revisable sin publicar automáticamente. |

## Ampliaciones futuras

Se mantienen como P3 tal cual las planteó la auditoría: son producto, no deuda.
No entran en planificación hasta que el núcleo esté estabilizado.

| ID | Ticket | Est. | Depende de |
|----|--------|:----:|------------|
| A30 | Crear la herramienta agregada `tiempo_municipio` | L | 17, 19, 20 |
| A32 | Incorporar climatología histórica e índice UV | XL | 17 |
| A33 | Incorporar predicción marítima, de montaña y playas | XL | 17 |
| A34 | Exponer radar e imágenes mediante recursos MCP | XL | 21 |

## Aplazados

No son malas ideas: son coste fijo que hoy no compra garantías proporcionales en
un proyecto de ~1.500 líneas con un único mantenedor. Se documentan con su
condición de reapertura para no perderlas ni arrastrarlas.

| ID | Ticket | Motivo | Reabrir cuando |
|----|--------|--------|----------------|
| A16 | Validar en runtime las respuestas de AEMET con esquemas | Talla L. El coste real no es escribir los esquemas, es mantenerlos sincronizados con una API que cambia sin avisar; un esquema desfasado convierte una respuesta buena en un fallo. | Aparezca un fallo de contrato real en producción que el acceso defensivo actual no haya absorbido. |
| A17 | Corpus de fixtures CAP anonimizados y parser endurecido | La parte explotable se cubre en el ticket 5. Lo que queda es robustez del parser CAP ante variaciones que aún no se han observado. | Un aviso real falle al parsearse. |
| A20 | Cobertura con umbrales mínimos | Con un solo mantenedor, los umbrales generan ruido en CI antes que garantías. Los tickets 7, 10 y 21 cubren el riesgo donde está. | El proyecto tenga más de un colaborador habitual. |
| A26 | Límites y mantenimiento de la caché | El proceso stdio es de vida corta y las claves están acotadas por el número de municipios y estaciones consultados en una sesión. El `Map` no crece sin control en la práctica. | Junto con `A6`, si el uso como librería en proceso largo pasa a ser un objetivo. |
| A29 | Reducir el tamaño del paquete publicado | Optimización sin problema observado; los source maps son útiles para diagnosticar. | El tarball crezca hasta molestar de verdad. |
| A31 | Integración periódica contra la API real | Ya existe `test/integration.aemet.test.ts`, que se salta sin `AEMET_API_KEY`. Basta ejecutarlo a mano antes de publicar; un workflow programado con secreto añade superficie de supply chain a cambio de poco. | La publicación se automatice hasta el punto de no revisarse a mano. |

## Entregas propuestas

| Entrega | Tickets | Objetivo |
|---------|---------|----------|
| **v0.2.2 — Robustez del cliente** | 1-8 | Que el servidor no pueda quedarse colgado, no filtre la API key fuera de AEMET y no reviente con una respuesta anómala. Los tickets 1-4 comparten fichero (`src/aemet/client.ts`): van en el mismo commit. |
| **v0.3.0 — Packaging y correcciones** | 9-14 | Cerrar de verdad el consumo del paquete y las correcciones pendientes. |
| **v0.4.0 — Geografía y MCP estructurado** | 15-20 | Mejorar búsquedas, desambiguación y consumo por agentes. |
| **v0.4.x — Calidad interna** | 21-26 | Aumentar garantías, mantenibilidad y operabilidad, sin la lista completa de la auditoría original. |
| **v0.5.0+ — Nuevas capacidades** | A30, A32-A34 | Ampliar el producto una vez estabilizado el núcleo. |

## Criterio de ejecución

Dentro de una misma prioridad debe respetarse la columna **Depende de**. Antes de
cerrar cada ticket deben ejecutarse, como mínimo, los tests dirigidos
relacionados, el typecheck y el build cuando el cambio afecte al código o al
paquete distribuido.

Dos criterios añadidos en esta revisión:

- **Verificar antes de arreglar.** Los tickets que describen un fallo no observado
  (`14`, `13`) empiezan por reproducirlo con datos reales. Si no se reproduce, el
  entregable es el fixture y la nota, no el cambio de código.
- **Agrupar por fichero, no por ticket.** Varios tickets tocan el mismo módulo
  (`client.ts` en 1-4, `format.ts` en 13-14). Abrirlos por separado multiplica
  conflictos y revisiones sin ganar nada.
