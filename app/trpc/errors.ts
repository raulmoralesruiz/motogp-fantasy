/**
 * Utilidades de errores tRPC para la UI (cliente).
 *
 * Los errores de validación Zod viajan en `error.data.zod` (ver
 * `errorFormatter` de `app/server/trpc.ts`); aquí se normalizan para
 * mostrarlos por campo.
 */

type ZodIssueLike = { path?: (string | number)[]; message: string };

/** Extrae los issues de Zod del error tRPC (si procede). */
export function zodIssues(error: unknown): ZodIssueLike[] {
  const data = (
    error as { data?: { zod?: ZodIssueLike[] | { issues?: ZodIssueLike[] } } } | null
  )?.data;
  const zod = data?.zod;
  if (Array.isArray(zod)) return zod;
  if (zod && Array.isArray(zod.issues)) return zod.issues;
  return [];
}
