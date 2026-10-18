/**
 * Helper para construir errores de cliente realistas (T-24, fase C).
 *
 * Los errores que recibe la UI son `TRPCClientError` (NO el
 * `TRPCError` de servidor, que en tRPC v11 no porta `data`): el `data`
 * viene del `errorFormatter` de `app/server/trpc.ts`
 * (`{ ...shape.data, code, message }`) y, en validaciones Zod, incluye
 * `zod: { issues }` (lo que normaliza `zodIssues` de `app/trpc/errors.ts`).
 */
import { TRPCClientError } from "@trpc/client";

/** Construye un `TRPCClientError` con `data` opcional (p. ej. `{ zod: { issues } }`). */
export function clientError(message: string, data?: unknown): Error {
  return new TRPCClientError(message, {
    result: {
      error: {
        code: -32600,
        message,
        data,
      },
    },
  });
}
