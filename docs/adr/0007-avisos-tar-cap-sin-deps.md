# 0007 — Avisos: parseo de tar.gz + CAP sin dependencias

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

El endpoint de avisos es el más complejo de la API: no devuelve JSON, sino un
**`tar.gz` de ficheros XML** en formato CAP (uno por zona/fenómeno, con bloques por
idioma). La mayoría son de nivel "verde" (sin aviso). Hay que descomprimir,
desempaquetar, parsear y filtrar a lo vigente.

## Decisión

Resolver toda la cadena **sin dependencias externas** (coherente con
[ADR-0002](./0002-sin-dependencias-pesadas.md)):

1. **Descompresión**: `node:zlib` (`gunzipSync`). Se detecta el _magic number_
   gzip; si `fetch` ya descomprimió por `Content-Encoding`, se trata como tar plano.
2. **Untar**: parser propio (`tar.ts`) que recorre bloques de 512 bytes.
3. **Parseo CAP**: extracción con regex del bloque `<info>` en `es-ES` y de los
   campos necesarios (nivel, fenómeno, zona, onset/expires, descripción, prob.).
4. **Filtrado**: se descartan verdes, expirados (`expires` < ahora) y no-`Actual`;
   se ordena por nivel (rojo > naranja > amarillo).

El resultado se cachea (~10 min) y se formatea agrupado por nivel.

## Consecuencias

- ➕ Cumple la promesa de avisos sin arrastrar librerías de tar/XML.
- ➕ Salida útil: solo lo vigente, agrupado y legible.
- ➖ El parseo por regex es específico del CAP de AEMET; un cambio de formato
  obligaría a ajustarlo (cubierto por tests con fixtures realistas).
- ➖ Descargas mayores que los endpoints JSON (un tar con decenas de XML), mitigado
  con caché.

## Alternativas consideradas

- Librerías `tar` + `fast-xml-parser`: más peso para un formato conocido y acotado.
- Dejar los avisos fuera del MVP: se valoró, pero son la herramienta que más
  diferencia al servidor de un simple wrapper de predicción.
