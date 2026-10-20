/**
 * Router de perfil (US-03): me, update, export, delete.
 *
 * - `me`/`update`: datos de la cuenta y nombre visible.
 * - `export`: derecho de acceso (GDPR) — JSON con cuenta, sesiones y juego.
 * - `delete`: derecho de supresión (ADR-0016) — anonimización con
 *   re-introducción de contraseña + rate limit por usuario. Tras el éxito
 *   la sesión queda revocada (todas las del usuario) y se limpia la cookie.
 */
import type { PrismaClient } from "@prisma/client";

import {
  AccountService,
  clearSessionCookie,
  type RateLimitStore,
} from "@/modules/identity";
import {
  deleteAccountInputSchema,
  updateProfileInputSchema,
} from "@/shared/validation/profile";

import { getServerEnv, isSessionCookieSecure } from "../env";
import { redisRateLimitStore } from "../rate-limit-redis";
import { prisma } from "../prisma";
import { protectedProcedure, router } from "../trpc";

export interface ProfileRouterDeps {
  prisma: PrismaClient;
  rateLimit: RateLimitStore;
  /** Rate limit de eliminación POR USUARIO (ADR-0016). */
  deleteRateLimit: { deleteMaxPerWindow: number; deleteWindowSec: number };
  secureCookie: boolean;
}

/** Router inyectable: los tests de integración lo montan con su propia BD y store. */
export function createProfileRouter(deps: ProfileRouterDeps) {
  const service = new AccountService({
    prisma: deps.prisma,
    rateLimit: deps.rateLimit,
    cfg: deps.deleteRateLimit,
  });

  return router({
    /** Perfil del usuario activo (sesión). */
    me: protectedProcedure.query(({ ctx }) => ({
      email: ctx.user.email,
      username: ctx.user.username,
      displayName: ctx.user.profile?.displayName ?? null,
      roles: ctx.user.userRoles.map((ur) => ur.role.name),
      createdAt: ctx.user.createdAt,
    })),

    /** Actualiza el nombre visible del perfil. */
    update: protectedProcedure
      .input(updateProfileInputSchema)
      .mutation(async ({ ctx, input }) => {
        await deps.prisma.profile.update({
          where: { userId: ctx.user.id },
          data: { displayName: input.displayName },
        });
        return { ok: true };
      }),

    /** Exportación de datos (derecho de acceso, GDPR): JSON. */
    export: protectedProcedure.query(({ ctx }) =>
      service.exportUserData(ctx.user.id),
    ),

    /**
     * Eliminación de cuenta (derecho de supresión, ADR-0016): anonimiza al
     * usuario. Requiere re-introducir la contraseña; rate limit por usuario.
     * Tras el éxito, todas sus sesiones quedan revocadas (queda deslogueado)
     * y se limpia la cookie de la respuesta.
     */
    delete: protectedProcedure
      .input(deleteAccountInputSchema)
      .mutation(async ({ ctx, input }) => {
        await service.deleteAccount(ctx.user.id, input, { ip: ctx.ip });
        ctx.pendingCookies.push(clearSessionCookie(deps.secureCookie));
        return { ok: true };
      }),
  });
}

/**
 * Router por defecto (producción): singletons de la app + parámetros por
 * env. Construcción perezosa para que importar el módulo (p. ej. por los
 * tipos) no exija el entorno.
 */
let defaultRouter: ReturnType<typeof createProfileRouter> | null = null;

export function getDefaultProfileRouter() {
  defaultRouter ??= (() => {
    const env = getServerEnv();
    return createProfileRouter({
      prisma,
      rateLimit: redisRateLimitStore,
      deleteRateLimit: {
        deleteMaxPerWindow: env.ACCOUNT_DELETE_RATE_LIMIT_MAX,
        deleteWindowSec: env.ACCOUNT_DELETE_RATE_LIMIT_WINDOW_SEC,
      },
      secureCookie: isSessionCookieSecure(),
    });
  })();
  return defaultRouter;
}
