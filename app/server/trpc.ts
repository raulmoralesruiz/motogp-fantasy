/**
 * Inicialización de tRPC (servidor).
 * - Transformer: superjson (fechas, Map, etc.).
 * - Contexto: prisma + redis + usuario de sesión + IP del cliente +
 *   cookies pendientes (US-01).
 * - Errores con el mensaje del procedimiento en español (AGENTS.md §2).
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { PrismaClient } from "@prisma/client";

import {
  canAccessGlobalAdmin,
  findActiveSessionUser,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
} from "@/modules/identity";

import { prisma } from "./prisma";
import { redis } from "./redis";

/** IP del cliente: X-Forwarded-For (Cloudflare/proxy) → X-Real-IP → "desconocida". */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real || "desconocida";
}

/**
 * Resuelve el contexto de la petición: IP del cliente + usuario activo
 * (cookie de sesión). `db` es inyectable para tests de integración.
 */
export async function createContext(req: Request, db: PrismaClient = prisma) {
  const cookies = parseCookieHeader(req.headers.get("cookie"));
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  const user = sessionToken ? await findActiveSessionUser(db, sessionToken) : null;
  return {
    prisma: db,
    redis,
    ip: clientIp(req),
    user,
    /**
     * Roles del usuario activo (T-08, RBAC): vacío si no hay sesión.
     * Lo consume `adminProcedure` y las guardas por recurso de cada módulo.
     */
    userRoles: user ? user.userRoles.map((ur) => ur.role.name) : [],
    /**
     * Token opaco de la cookie de sesión (US-02: `auth.logout` lo revoca en
     * BD). Solo definido cuando hay cookie; si `user` no es null, también
     * lo está (la sesión se resuelve a partir de él).
     */
    sessionToken,
    /** Cabeceras `Set-Cookie` que el handler añadirá a la respuesta (US-01). */
    pendingCookies: [] as string[],
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        code: error.code,
        message: error.message,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const mergeRouters = t.mergeRouters;

/**
 * Procedimiento para usuarios autenticados: el usuario se resuelve en
 * `createContext` (cookie de sesión) y se rechaza con mensaje explícito
 * si no hay sesión.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "No estás autenticado" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Procedimiento del panel de administración global (T-08, security.md §1.5):
 * exige sesión activa y el rol `global_admin`. Un usuario autenticado sin el
 * rol recibe 403 FORBIDDEN (está autenticado pero no tiene permiso: no es
 * UNAUTHORIZED).
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!canAccessGlobalAdmin(ctx.userRoles)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tienes permisos para acceder al panel de administración.",
    });
  }
  return next({ ctx });
});
