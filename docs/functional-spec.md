# Documentación funcional

Este documento describe **qué hace** aemet-mcp desde el punto de vista del usuario
y del modelo de lenguaje que lo consume, sin entrar en detalles de implementación
(para eso, ver [architecture.md](./architecture.md)).

## 1. Propósito

aemet-mcp es un **servidor MCP** que expone el tiempo oficial de España (AEMET)
como un conjunto de herramientas que un asistente de IA puede invocar. Convierte
preguntas en lenguaje natural ("¿lloverá mañana en Bilbao?") en llamadas tipadas a
la API de AEMET, y devuelve la respuesta en texto legible.

### Público objetivo

- **Usuarios finales** de Claude Desktop / Cursor que quieren consultar el tiempo.
- **Desarrolladores** que integran capacidades meteorológicas en agentes MCP.

### Fuera de alcance

- No es una web ni una API HTTP: es un servidor MCP por stdio.
- No hace predicción propia ni transforma los datos científicos de AEMET; los
  presenta de forma legible.
- No cubre datos climatológicos históricos ni radar/satélite (posible futuro).

## 2. Capacidades

| Capacidad | Herramienta | Cobertura |
|-----------|-------------|-----------|
| Resolver municipio | `buscar_municipio` | 8132 municipios del INE |
| Predicción a varios días | `prediccion_diaria` | 1-7 días, todos los municipios |
| Predicción horaria | `prediccion_horaria` | Hoy y mañana |
| Observación en tiempo casi real | `observacion_estacion` | ~920 estaciones |
| Avisos de fenómenos adversos | `avisos` | 19 comunidades autónomas |

## 3. Casos de uso

### CU-1: Consultar la predicción de una ciudad

> Usuario: *"¿Qué tiempo hará este fin de semana en Sevilla?"*

1. El modelo llama a `prediccion_diaria` con `municipio: "Sevilla"`.
2. El servidor resuelve "Sevilla" → código INE `41091` (dataset local).
3. Descarga la predicción diaria de AEMET y la formatea.
4. El modelo responde con máximas, mínimas, cielo y probabilidad de lluvia.

### CU-2: Desambiguar un nombre repetido

> Usuario: *"El tiempo en Villanueva."*

1. `prediccion_diaria` con `municipio: "Villanueva"`.
2. Hay decenas de municipios "Villanueva de…". El servidor devuelve un error
   estructurado con las opciones y sus códigos INE.
3. El modelo pide precisión o elige según contexto y reintenta con el código.

### CU-3: Comprobar avisos antes de un viaje

> Usuario: *"¿Hay algún aviso meteorológico en Cataluña?"*

1. `avisos` con `area: "Cataluña"`.
2. El servidor descarga el paquete CAP de la comunidad, filtra los avisos vigentes
   (no verdes, no expirados) y los agrupa por nivel.
3. El modelo resume: nivel máximo, número de avisos, zonas y fenómenos.

### CU-4: Observación actual de una estación

> Usuario: *"¿Cuánta temperatura hace ahora mismo en el Retiro?"*

1. `observacion_estacion` sin argumentos (o `estacion: "Retiro"`).
2. El servidor devuelve la última observación: temperatura, humedad, viento, etc.

## 4. Entradas y salidas

Todas las herramientas:

- Reciben parámetros validados con **zod** (el cliente MCP los ve como JSON Schema).
- Devuelven **texto plano estructurado** (resumen + datos), pensado para que el
  modelo lo lea y reformule, no JSON crudo.
- En caso de error, devuelven un mensaje claro marcado como error (`isError`), sin
  inventar datos.

Ver el detalle campo a campo en [tools-reference.md](./tools-reference.md).

## 5. Reglas de negocio

- **Resolución de municipios**: se normaliza la entrada (minúsculas, sin acentos)
  y se prioriza coincidencia exacta > empieza-por > contiene. Un código INE de 5
  dígitos se usa directamente.
- **Avisos vigentes**: se descartan los de nivel *verde* (sin aviso), los ya
  expirados (`expires` < ahora) y los que no tienen `status = Actual`.
- **Estación por defecto**: si no se indica estación, `observacion_estacion` usa
  Madrid-Retiro (idema `3195`) y lo indica en la salida.
- **Idioma**: los avisos CAP se leen del bloque en español (`es-ES`).

## 6. Errores visibles para el usuario

| Situación | Mensaje aproximado |
|-----------|--------------------|
| Falta la API key | "Falta la API key de AEMET. Define AEMET_API_KEY." |
| Key inválida (401) | "API key inválida o no autorizada…" |
| Sin datos (404) | "AEMET no tiene datos para el recurso solicitado…" |
| Límite superado (429) | "Límite de peticiones de AEMET superado…" (tras reintentos) |
| Nombre ambiguo | Lista de municipios/estaciones candidatos con su código |
| CCAA desconocida | "No se reconoce la comunidad autónoma… Válidas: …" |

## 7. Rendimiento y límites

- **Caché** en memoria reduce llamadas repetidas dentro de la vida del proceso.
- La API gratuita de AEMET tiene límites de uso; el servidor reintenta con backoff
  ante `429` pero no los elude.
- El dataset de municipios está bundleado: resolver un nombre **no** consume cuota.
