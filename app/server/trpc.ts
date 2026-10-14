/**
 * Inicialización de tRPC (servidor).
 * - Transformer: superjson (fechas, Map, etc.).
 * - Contexto: prisma + redis.
 * - Errores estándar con mensaje legible en español (AGENTS.md §2).
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";

import { prisma } from "./prisma";
import { redis } from "./redis";

export function createContext() {
  return { prisma, redis };
}

export type Context = ReturnType<typeof createContext>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        code: error.code,
        message:
          error.code === "UNAUTHORIZED"
            ? "No estás autenticado"
            : error.code === "FORBIDDEN"
              ? "No tienes permiso para esta acción"
              : error.message,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const mergeRouters = t.mergeRouters;
