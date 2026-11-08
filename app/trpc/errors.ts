/**
 * Utilidades de errores tRPC para la UI (cliente).
 *
 * Los errores de validación Zod viajan en `error.data.zod` (ver
 * `errorFormatter` de `app/server/trpc.ts`); aquí se normalizan para
 * mostrarlos por campo.
 *
 * `isUnauthorized` y `friendlyMessage` (T-26) vivían duplicados en
 * `app/page.tsx`, `app/perfil/perfil-page.tsx` y
 * `app/ligas/[id]/league-detail-page.tsx`; el header global (4.ª aparición)
 * los centraliza aquí, su casa natural.
 */

/**
 * F3 P3-1: `auth.me` falla con UNAUTHORIZED cuando no hay sesión (estado
 * normal de una página pública, NO un fallo), pero también puede fallar por
 * un error real (500, red). Solo el UNAUTHORIZED significa "sin sesión"; el
 * resto es un fallo que hay que mostrar, no enmascarar como "no has iniciado
 * sesión".
 */
export function isUnauthorized(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null)?.data?.code === "UNAUTHORIZED";
}

/** Códigos de error de tRPC (no son mensajes legibles para el usuario). */
const TRPC_CODES = new Set([
  "PARSE_ERROR",
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "UNPROCESSABLE_CONTENT",
  "NOT_FOUND",
  "PRECONDITION_FAILED",
  "METHOD_NOT_SUPPORTED",
  "PAYLOAD_TOO_LARGE",
  "UNEXPECTED_ERROR",
  "INTERNAL_SERVER_ERROR",
]);

/**
 * Mensaje amigable para errores de red/servicio (F3 P3): los códigos de tRPC
 * ("INTERNAL_SERVER_ERROR", "fetch failed"…) no son legibles para el usuario
 * → frase neutra. Los mensajes de la app (en español) se muestran tal cual.
 */
export function friendlyMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (!raw || TRPC_CODES.has(raw) || (code !== undefined && TRPC_CODES.has(code))) {
    return "el servidor no pudo responder";
  }
  if (raw === "fetch failed") return "no hay conexión con el servidor";
  return raw;
}

type ZodIssueLike = { path?: string | number[]; message: string };

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
