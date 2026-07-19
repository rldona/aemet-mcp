# Notas técnicas de la API de AEMET OpenData

Referencia de las particularidades de la API pública de AEMET que este proyecto
encapsula. Útil como documentación y para quien mantenga el cliente.

Base URL: `https://opendata.aemet.es/opendata/api`

## Autenticación

- API key gratuita: alta en <https://opendata.aemet.es/centrodedescargas/inicio>.
  Llega por email (es un JWT largo).
- Se envía en la cabecera `api_key: <KEY>` (también admite `?api_key=` como query,
  pero este proyecto usa la cabecera en ambos saltos).

## Patrón de dos pasos

Casi todos los endpoints devuelven primero un **sobre JSON**:

```json
{
  "estado": 200,
  "descripcion": "exito",
  "datos": "https://opendata.aemet.es/opendata/sh/xxxxxxxx",
  "metadatos": "https://opendata.aemet.es/opendata/sh/yyyyyyyy"
}
```

El contenido real está en un **segundo GET** a la URL de `datos`. La de
`metadatos` describe el esquema (no se usa aquí).

## Códigos de estado (`estado`)

| `estado` | Significado | Trato en el cliente |
|----------|-------------|---------------------|
| 200 | OK | Continúa al segundo salto |
| 401 | API key inválida | `AemetError UNAUTHORIZED` |
| 404 | Sin datos para el recurso | `AemetError NOT_FOUND` |
| 429 | Too many requests | Reintenta con backoff; si persiste, `RATE_LIMITED` |
| otros | Inesperado | `AemetError UPSTREAM` |

El `estado` puede venir en el cuerpo del sobre (HTTP 200) o a nivel HTTP; el
cliente contempla ambos.

## Encoding: ISO-8859-1 (latin1)

Tanto los ficheros de `datos` como las **descripciones de los sobres** vienen en
**latin1**, no UTF-8. Hay que decodificar con `new TextDecoder('latin1')`; con
UTF-8 los acentos salen rotos (p. ej. `l�mites`). Excepción: los ficheros CAP de
avisos son UTF-8 (ver abajo).

## Endpoints usados

| Recurso | Path |
|---------|------|
| Predicción diaria | `/prediccion/especifica/municipio/diaria/{codigoINE}` |
| Predicción horaria | `/prediccion/especifica/municipio/horaria/{codigoINE}` |
| Observación de estación | `/observacion/convencional/datos/estacion/{idema}` |
| Inventario de estaciones | `/valores/climatologicos/inventarioestaciones/todasestaciones` |
| Avisos CAP por área | `/avisos_cap/ultimoelaborado/area/{codigoArea}` |

- `{codigoINE}`: 5 dígitos (provincia + municipio del INE).
- `{idema}`: identificador de estación (p. ej. `3195` = Madrid-Retiro).
- `{codigoArea}`: 2 dígitos por CCAA (ver tabla).

## Avisos: tar.gz de CAP XML

El endpoint de avisos **no devuelve JSON**, sino un `tar.gz` de ficheros XML en
formato [CAP 1.2](https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2.html).

- Cada `.xml` es una alerta con bloques `<info>` por idioma (`es-ES`, `en-GB`).
- Nivel del aviso: `<parameter>` con `valueName = "AEMET-Meteoalerta nivel"` y
  valor `verde | amarillo | naranja | rojo`. Los *verdes* significan "sin aviso".
- Fenómeno: `<parameter>` `AEMET-Meteoalerta fenomeno` (p. ej. `AT;Temperaturas máximas`).
- Vigencia: `<onset>` / `<expires>` (con offset horario peninsular).
- Nota: por Node `fetch`, el `tar.gz` puede llegar ya descomprimido (por
  `Content-Encoding`), así que el cliente detecta el _magic_ gzip y actúa en
  consecuencia.

### Códigos de área de CCAA (VERIFICADOS)

⚠️ **No siguen el orden intuitivo**: van en orden **alfabético** de comunidad. Se
verificaron uno a uno contra la API inspeccionando las zonas devueltas.

| Código | Comunidad | | Código | Comunidad |
|--------|-----------|-|--------|-----------|
| 61 | Andalucía | | 71 | Galicia |
| 62 | Aragón | | 72 | Comunidad de Madrid |
| 63 | Asturias | | 73 | Región de Murcia |
| 64 | Islas Baleares | | 74 | Navarra |
| 65 | **Canarias** | | 75 | País Vasco |
| 66 | **Cantabria** | | 76 | La Rioja |
| 67 | Castilla y León | | 77 | Comunidad Valenciana |
| 68 | Castilla-La Mancha | | 78 | **Ceuta** |
| 69 | Cataluña | | 79 | Melilla |
| 70 | Extremadura | | | |

Errores frecuentes al asumir el orden "lógico": 65 **no** es Cantabria (es
Canarias) y 78 **no** es Canarias (es Ceuta). Ver
[ADR-0008](./adr/0008-codigos-area-avisos.md).

## Límites de uso

La API gratuita impone límites globales por minuto. El cliente reintenta con
backoff ante `429`, pero no los elude: si se agotan los reintentos, propaga
`RATE_LIMITED`. La caché en memoria ayuda a no repetir peticiones.
