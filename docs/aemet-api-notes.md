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

## Encoding: inconsistente (auto-detección + reparación de mojibake)

AEMET **mezcla codificaciones** según el recurso y el nodo CDN que responda: hay
recursos en **latin1** (ISO-8859-1) y otros en **UTF-8** (p. ej. la predicción
municipal). Peor aún, a veces **declara `charset=ISO-8859-15` sirviendo bytes
UTF-8**, y algún `fetch` intermedio (el fetch parcheado de Next.js, proxies) se cree
la cabecera y transcodifica, produciendo **mojibake doble** (`AndÃºjar` → debería
ser `Andújar`). Fiarse del `charset` de la cabecera **no** funciona.

Por eso el cliente **no asume una sola codificación**, sino que:

1. **Auto-detecta** el fichero de `datos`: `TextDecoder('utf-8', { fatal: true })`
   y, si los bytes no son UTF-8 válido, cae a `latin1`.
2. Aplica **`reparaMojibake`** (deshace la doble codificación `Ã…`; idempotente).
3. Tras `JSON.parse`, aplica **`reparaProfundo`** a cada string (el nodo CDN puede
   variar entre llamadas).
4. Las **descripciones de los sobres** de error se decodifican en **latin1** (son
   estables). Los ficheros CAP de avisos son UTF-8 (ver abajo).

`reparaMojibake` y `reparaProfundo` se exportan en la API de librería del paquete
(`@rldona/aemet-mcp`) para backends que consuman AEMET directamente. Detalle en
[ADR-0012](./adr/0012-codificacion-autodetectada-mojibake.md).

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
