# Referencia de herramientas

Detalle de cada herramienta MCP: nombre, entrada (esquema zod), qué devuelve,
ejemplos y errores. Los nombres y descripciones son los que ve el modelo.

---

> Todas las herramientas declaran `outputSchema` y devuelven `structuredContent`
> además del texto. Los valores van tipados (números como números, fechas ISO) y
> lo que AEMET no da es `null`, nunca ausente ni cadena vacía.
>
> **Unidades**: el viento va siempre en **km/h** (AEMET lo publica en m/s en la
> observación y en km/h en la predicción; aquí se unifica) y la dirección viene en
> las dos formas, `direccion` como rumbo de 8 y `direccionGrados` en grados. `"C"`
> es calma. Cada respuesta con magnitudes trae además un campo `unidades` dentro
> del payload: en una sesión real el modelo ve el JSON, no el `outputSchema`.
>
> **Fechas**: todos los instantes salen en ISO 8601 con offset explícito. AEMET
> publica `elaborado` sin zona; se interpreta como hora peninsular y el schema dice
> que esa suposición es del servidor, no un dato de AEMET.

## `buscar_municipio`

Busca municipios españoles por nombre y devuelve su código INE de 5 dígitos.

**NO hace falta llamarla antes de las demás**: `prediccion_diaria`,
`prediccion_horaria`, `observacion_municipio` y `avisos_municipio` aceptan el
nombre y lo resuelven solas. Está para cuando se pide explícitamente el código, o
para ver las opciones tras un error de ambigüedad.

**Entrada**

| Campo    | Tipo             | Req. | Descripción |
|----------|------------------|------|-------------|
| `nombre` | `string` (min 1) | Sí   | Nombre a buscar, p. ej. `"Málaga"`. También un nombre de isla. |

**Salida** — lista de coincidencias (exacta > isla > empieza-por > contiene), máx. 15.

```
3 municipios coinciden con "malaga":
• Málaga (Málaga) — código INE 29067
• Málaga del Fresno (Guadalajara) — código INE 19166
• Vélez-Málaga (Málaga) — código INE 29094
```

Con un nombre de isla devuelve **sus municipios**, aunque no contengan la palabra,
y lo dice:

```
"El Hierro" es una isla (El Hierro), no un municipio. Sus 3 municipios, que es lo
que entiende AEMET:
• Frontera (Santa Cruz de Tenerife, El Hierro) — código INE 38013
• el Pinar de El Hierro (Santa Cruz de Tenerife, El Hierro) — código INE 38901
• Valverde (Santa Cruz de Tenerife, El Hierro) — código INE 38048
```

Cada municipio insular lleva su `isla` en la salida estructurada. Es lo que
permite distinguir cuál de los quince "Valverde" es el de El Hierro.

**Errores** — si no hay coincidencias, lo indica en texto (no es error duro).

---

## `prediccion_diaria`

Predicción diaria (hasta 7 días) de un municipio: temperatura máx/mín, estado del
cielo, probabilidad de precipitación y viento.

**Entrada**

| Campo       | Tipo                    | Req. | Descripción |
|-------------|-------------------------|------|-------------|
| `municipio` | `string` (min 1)        | Sí   | Nombre o código INE de 5 dígitos. |
| `dias`      | `int` 1-7               | No   | Días a incluir. Por defecto 7. |
| `desde`     | `string` `YYYY-MM-DD`   | No   | Primer día a incluir (inclusive). |
| `hasta`     | `string` `YYYY-MM-DD`   | No   | Último día a incluir (inclusive). |

`desde`/`hasta` evitan el patrón de pedir siete días para quedarse con dos: para
"este fin de semana" se acota el rango en la propia llamada.

**Salida**

```
Predicción diaria — Madrid (Madrid)
Elaborada: 2026-07-19 07:23:09

domingo 19/07
  Máx 36 °C / Mín 22 °C  |  Cielo: Poco nuboso  |  Prob. precip.: 0%  |  Viento: SO a 15 km/h
```

**Errores** — nombre ambiguo → lista de candidatos con su código; código
inexistente → mensaje claro; fallos de AEMET → `AemetError` traducido.

---

## `prediccion_horaria`

Predicción hora a hora del día en curso y el siguiente: temperatura, cielo,
precipitación y viento por hora.

**Entrada**

| Campo       | Tipo             | Req. | Descripción |
|-------------|------------------|------|-------------|
| `municipio` | `string` (min 1) | Sí   | Nombre o código INE. |
| `dias`      | `int` 1-2        | No   | Días (hoy y mañana). Por defecto 2. |
| `desde`     | `string` `YYYY-MM-DD` | No | Primer día a incluir (inclusive). |
| `hasta`     | `string` `YYYY-MM-DD` | No | Último día a incluir (inclusive). |

**Salida**

```
Predicción horaria — Madrid (Madrid)
Elaborada: 2026-07-19 07:23:09

── domingo 19/07 ──
  13:00  ·  31°C  ·  Despejado  ·  viento SO a 14 km/h
  14:00  ·  33°C  ·  Despejado  ·  viento SO a 17 km/h
```

---

## `observacion_estacion`

Última observación convencional de una estación de AEMET: temperatura, humedad,
viento, precipitación y presión.

**Entrada**

| Campo      | Tipo     | Req. | Descripción |
|------------|----------|------|-------------|
| `estacion` | `string` | No   | Idema (p. ej. `"3195"`) o nombre. Por defecto Madrid-Retiro. |

**Salida**

```
Última observación — MADRID RETIRO (estación 3195)
Hora del dato: 2026-07-19T07:00:00+00:00

Temperatura:  21.7 °C
Humedad:      41 %
Precip. (última hora): 0 mm
Viento:       SE a 5 km/h (143°)
Presión:      939.2 hPa
```

**Errores** — nombre ambiguo → lista de estaciones con su idema.

---

## `avisos`

Avisos meteorológicos vigentes de una comunidad autónoma, con nivel
(amarillo/naranja/rojo), zona afectada y periodo. Fuente: avisos CAP de AEMET.

**Entrada**

| Campo  | Tipo             | Req. | Descripción |
|--------|------------------|------|-------------|
| `area` | `string` (min 1) | Sí   | Nombre de CCAA o código de área de 2 dígitos. |

**Comunidades válidas**: Andalucía, Aragón, Asturias, Islas Baleares, Canarias,
Cantabria, Castilla y León, Castilla-La Mancha, Cataluña, Extremadura, Galicia,
Comunidad de Madrid, Región de Murcia, Navarra, País Vasco, La Rioja, Comunidad
Valenciana, Ceuta, Melilla. Se aceptan alias comunes (`euskadi`, `madrid`, …).

**Salida**

```
Avisos meteorológicos vigentes — Andalucía
Elaborado: 2026-07-18 21:50:01
52 avisos (12 naranja, 40 amarillo). Nivel máximo: NARANJA.

🟠 NARANJA (12)
  • Cuenca del Genil: Temperaturas máximas  ·  19/07 13:00 → 19/07 20:59  ·  Temperatura máxima: 40 ºC.  ·  prob. 40%-70%
🟡 AMARILLO (40)
  • ...
```

Si no hay avisos activos: `Sin avisos meteorológicos activos en <CCAA> ahora mismo.`

**Errores** — CCAA desconocida → mensaje con la lista de válidas.

---

## `buscar_estacion`

Estaciones meteorológicas de AEMET por nombre, provincia o idema, con coordenadas.

**Entrada**

| Campo | Tipo | Req. | Descripción |
|-------|------|:----:|-------------|
| `consulta` | string | sí | Nombre de estación o ciudad, provincia o idema. |
| `limite` | number | no | Máximo de resultados (1-50). Por defecto 20. |

**Salida estructurada**: `{ consulta, total, estaciones: [{ idema, nombre,
provincia, latitud, longitud, altitud }] }`. Las coordenadas van en grados
decimales (negativas al oeste); el inventario de AEMET las publica como DMS
empaquetado (`402441N`) y se convierten aquí.

---

## `observacion_municipio`

Tiempo observado ahora mismo cerca de un municipio. Resuelve el municipio, obtiene
sus coordenadas del maestro de AEMET, ordena las estaciones por distancia y
devuelve la observación de la más cercana **que tenga datos**: muchas estaciones
del inventario son solo climatológicas y responden 404, así que se prueban hasta
cinco antes de rendirse.

**Entrada**

| Campo | Tipo | Req. | Descripción |
|-------|------|:----:|-------------|
| `municipio` | string | sí | Nombre o código INE de 5 dígitos. |
| `estacion` | string | no | Idema de una de las candidatas, para forzarla. |

**Salida estructurada**: los valores de observación más `estacion` (con
`distanciaKm` y `estado`) y `candidatas`, la lista de estaciones próximas
ordenadas por distancia, para poder pedir otra.

**El dato es de una estación, no del municipio**, y a veces la diferencia importa.
Ceuta es el caso claro: sus dos estaciones propias, a 1,5 y 3,6 km, son solo
climatológicas y no publican; la más cercana con datos es Tarifa, a 29,7 km, en
Cádiz y al otro lado del Estrecho. El dato se sirve igual —es lo mejor que hay—
pero la respuesta lo marca:

| Campo | Significado |
|-------|-------------|
| `representaAlMunicipio` | `false` si la estación está a más de 20 km o en otra provincia. |
| `advertencia` | Texto explícito con el motivo. En la salida de texto va **antes** de los números, no como nota al pie. |

El umbral de 20 km no es arbitrario: en el muestreo de campo la mediana de
distancia a la estación con datos fue 12,4 km y el percentil 90, 19 km.

Cada candidata lleva `estado`: `"con datos"` y `"sin datos"` son comprobados,
`"no consultada"` significa que no hizo falta llegar a ella. La búsqueda para en la
primera que responde, así que llamar "sin datos" a una que nadie miró sería
inventarse el resultado.

Si se **fuerza** una estación con `estacion` y esa estación no publica
observación, es un error explícito que lo dice, no una respuesta con todo a `null`.

Frente a `observacion_estacion`, esta no exige saber qué estación mide un sitio, y
dice explícitamente a qué distancia está el dato y de cuándo es.

---

## `avisos_municipio`

Avisos vigentes que afectan a un municipio concreto, no a toda su comunidad.

**Entrada**

| Campo | Tipo | Req. | Descripción |
|-------|------|:----:|-------------|
| `municipio` | string | sí | Nombre o código INE de 5 dígitos. |
| `incluirComunidad` | boolean | no | Devuelve además los avisos del resto de la CCAA. Por defecto `false`. |

Los CAP de AEMET traen el **polígono** de cada zona de aviso, así que el filtro es
geométrico: se comprueba si el punto del municipio cae dentro. Con datos reales,
de 22 avisos vigentes en Andalucía, a Granada le afectaban 1 y a Almería ninguno.

**Salida estructurada**: además de los avisos, `alcance` dice qué se está mirando
—`"municipio"` si se pudo acotar, `"comunidad"` si no— junto a `total` y
`totalComunidad`. Un aviso cuya zona no trae geometría **no se descarta**: se
incluye y el alcance pasa a `"comunidad"`, porque ocultar en silencio un aviso
rojo por no saber dibujarlo es peor que mostrarlo de más.

`totalComunidad` sin más era un cebo: decía "hay 3 en la comunidad" y enseñaba 1,
obligando a una segunda llamada a `avisos` para ver el resto. Con
`incluirComunidad: true` vienen en `avisosComunidad` en la misma respuesta.

**Nombres compartidos.** "Madrid" es municipio, provincia y comunidad. Se elige el
municipio —que acierta casi siempre— pero la respuesta lo declara en `nota` y
explica cómo pedir la comunidad. En Ceuta y Melilla no dice nada: allí municipio y
ciudad autónoma son lo mismo.

---

## Códigos de error (`AemetError.code`)

| Código            | Cuándo | Estado |
|-------------------|--------|--------|
| `MISSING_API_KEY` | No hay `AEMET_API_KEY` en el entorno | — |
| `UNAUTHORIZED`    | Key inválida o caducada | 401 |
| `NOT_FOUND`       | AEMET no tiene datos del recurso | 404 |
| `RATE_LIMITED`    | Límite de peticiones (tras agotar reintentos) | 429 |
| `UPSTREAM`        | Otro estado inesperado / 5xx persistente | var. |
| `NETWORK`         | Fallo de red tras reintentos | — |
| `TIMEOUT`         | AEMET no respondió dentro del tiempo máximo por intento | — |
| `TOO_LARGE`       | La respuesta supera el tamaño máximo aceptado | — |
| `UNSAFE_URL`      | AEMET apuntó a una URL a la que no se envía la API key | var. |
| `PARSE`           | Respuesta no parseable | — |

`RATE_LIMITED` llega solo **después** de que el cliente haya reintentado con
espera, así que repetir de inmediato no sirve de nada; el mensaje lo dice. Si AEMET
manda `Retry-After`, el error trae los segundos en `retryAfterMs` y en el texto.
Cuando la cabecera no viene no se inventa un número.
