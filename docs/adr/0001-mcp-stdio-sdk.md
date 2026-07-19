# 0001 — Protocolo MCP por stdio con el SDK oficial

- **Estado**: Aceptada
- **Fecha**: 2026-07-19

## Contexto

El objetivo es dar a clientes LLM locales (Claude Desktop, Cursor) acceso al tiempo
de AEMET. Estos clientes hablan el **Model Context Protocol (MCP)** y lanzan
servidores locales como subprocesos comunicados por **stdio**. Necesitamos un
transporte y una forma de declarar herramientas que el cliente entienda sin
adaptadores.

## Decisión

Usar el SDK oficial **`@modelcontextprotocol/sdk`** con `McpServer` y transporte
`StdioServerTransport`. Registrar cada herramienta con `registerTool`, usando
esquemas **zod** para la entrada (el SDK los expone como JSON Schema al cliente).

Se sigue la API vigente de la versión instalada del SDK (no la memoria): la firma
`registerTool(name, { title, description, inputSchema }, cb)` y el resultado
`{ content: [{ type: "text", text }], isError? }`.

## Consecuencias

- ➕ Compatibilidad directa con Claude Desktop/Cursor: se enchufa con un bloque de
  configuración `mcpServers`, sin capa intermedia.
- ➕ `stdout` queda reservado para el protocolo; los diagnósticos van a `stderr`.
- ➖ Acoplamiento a la evolución del SDK (mitigado fijando el rango de versión y
  siguiendo su README).
- El servidor arranca aunque falte la API key (lista las tools); el error solo
  aparece al invocar una tool que llame a AEMET.

## Alternativas consideradas

- **Servidor HTTP/SSE propio**: descartado; el requisito es stdio local y no añadir
  backend.
- **Implementar el protocolo a mano**: innecesario y frágil frente al SDK oficial.
