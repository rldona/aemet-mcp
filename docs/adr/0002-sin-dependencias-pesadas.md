# 0002 — Sin dependencias pesadas

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

Es una librería open source pequeña que se instala con `npx`. Cada dependencia
suma superficie de ataque, peso de instalación y mantenimiento. El reto incluye
tareas que "tradicionalmente" tiran de librerías: cliente HTTP, descompresión y
parseo de XML.

## Decisión

Mantener las dependencias de runtime al mínimo: **solo** `@modelcontextprotocol/sdk`
y `zod`. Todo lo demás se resuelve con APIs nativas de Node:

- HTTP → `fetch` nativo (undici), sin axios.
- Descompresión gzip → `node:zlib` (`gunzipSync`).
- Extracción de tar → parser propio (`tar.ts`, ~50 líneas).
- Parseo de CAP XML → extracción con regex acotadas (los CAP de AEMET son planos y
  regulares).
- Decodificación latin1 → `TextDecoder`.

## Consecuencias

- ➕ Paquete ligero (~200 kB empaquetado) y árbol de dependencias pequeño.
- ➕ Menos riesgo de vulnerabilidades transitivas y de _breaking changes_ ajenos.
- ➖ Código propio de tar y de parseo CAP que hay que mantener y testear (mitigado
  con tests dedicados).
- ➖ El parseo por regex es válido para el CAP concreto de AEMET, no para XML
  arbitrario; si AEMET cambiara el formato, habría que ajustarlo.

## Alternativas consideradas

- `axios` → innecesario con `fetch` nativo.
- `tar` / `tar-stream` → dependencia y API de streams para un caso simple.
- `fast-xml-parser` / `xml2js` → potentes pero excesivos para extraer 6 campos de
  un CAP conocido.
