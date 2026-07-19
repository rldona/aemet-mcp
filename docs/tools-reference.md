# Referencia de herramientas

Detalle de cada herramienta MCP: nombre, entrada (esquema zod), qué devuelve,
ejemplos y errores. Los nombres y descripciones son los que ve el modelo.

---

## `buscar_municipio`

Busca municipios españoles por nombre y devuelve su código INE de 5 dígitos.
Úsala **primero** cuando el usuario dé un nombre, porque las predicciones necesitan
el código INE.

**Entrada**

| Campo    | Tipo             | Req. | Descripción |
|----------|------------------|------|-------------|
| `nombre` | `string` (min 1) | Sí   | Nombre a buscar, p. ej. `"Málaga"`. |

**Salida** — lista de coincidencias (exacta > empieza-por > contiene), máx. 15.

```
3 municipios coinciden con "malaga":
• Málaga — código INE 29067
• Málaga del Fresno — código INE 19166
• Vélez-Málaga — código INE 29094
```

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

**Salida**

```
Predicción diaria — Madrid (Madrid)
Elaborada: 2026-07-19 07:23:09

domingo 19/07
  Máx 36 °C / Mín 22 °C  |  Cielo: Poco nuboso  |  Prob. precip.: 0%  |  Viento: SO 15 km/h
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

**Salida**

```
Predicción horaria — Madrid (Madrid)
Elaborada: 2026-07-19 07:23:09

── domingo 19/07 ──
  13:00  ·  31°C  ·  Despejado  ·  viento SO 14 km/h
  14:00  ·  33°C  ·  Despejado  ·  viento SO 17 km/h
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
Hora (UTC): 2026-07-19T07:00:00+0000

Temperatura:  21.7 °C
Humedad:      41 %
Precip. (última hora): 0 mm
Viento:       1.4 m/s del 143°
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

## Códigos de error (`AemetError.code`)

| Código            | Cuándo | Estado |
|-------------------|--------|--------|
| `MISSING_API_KEY` | No hay `AEMET_API_KEY` en el entorno | — |
| `UNAUTHORIZED`    | Key inválida o caducada | 401 |
| `NOT_FOUND`       | AEMET no tiene datos del recurso | 404 |
| `RATE_LIMITED`    | Límite de peticiones (tras agotar reintentos) | 429 |
| `UPSTREAM`        | Otro estado inesperado / 5xx persistente | var. |
| `NETWORK`         | Fallo de red tras reintentos | — |
| `PARSE`           | Respuesta no parseable | — |
