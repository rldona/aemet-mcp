// Normalización de texto para búsquedas tolerantes.
//
// Vive en su propio módulo, y no en `municipios.ts`, porque `islas.ts` también
// la necesita y `municipios.ts` importa islas: dejarla allí creaba un ciclo.

/** Normaliza para match tolerante: minúsculas, sin acentos, sin puntuación. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // quita diacríticos combinantes (acentos, tildes)
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
