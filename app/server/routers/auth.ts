/**
 * Router de autenticación (US-01): register, login, me.
 *
 * La cookie de sesión la monta el handler de tRPC
 * (`app/api/trpc/[trpc]/route.ts`) a partir de `ctx.pendingCookies`: la
 * construcción de la cookie es una función pura (modules/identity/sessions)
 * testable sin HTTP.
 */
import type { PrismaClient } from "@prisma/client";

import {
  AuthService,
  buildSessionCookie,
  toPublicUser,
  type RateLimitStore,
} from "@/modules/identity";
import { loginInputSchema, registerInputSchema } from "@/shared/validation/auth";

import { getServerEnv, isSessionCookieSecure } from "../env";
import { redisRateLimitStore } from "../rate-limit-redis";
import { prisma } from "../prisma";
import { publicProcedure, protectedProcedure, router, type Context } from "../trpc";

export interface AuthRouterDeps {
  prisma: PrismaClient;
  rateLimit: RateLimitStore;
  sessionTtlSec: number;
  secureCookie: boolean;
  rateLimitCfg: {
    maxPerWindow: number;
    windowSec: number;
    lockoutThreshold: number;
    lockoutSec: number;
  };
}

/** Router inyectable: los tests de integración lo montan con su propia BD y store. */
export function createAuthRouter(deps: AuthRouterDeps) {
  const service = new AuthService({
    prisma: deps.prisma,
    rateLimit: deps.rateLimit,
    cfg: { ...deps.rateLimitCfg, sessionTtlSec: deps.sessionTtlSec },
  });

  function issueSessionCookie(ctx: Context, token: string): void {
    ctx.pendingCookies.push(
      buildSessionCookie(token, {
        maxAgeSec: deps.sessionTtlSec,
        secure: deps.secureCookie,
      }),
    );
  }

  return router({
    /** Registro (US-01): email + contraseña + nombre de usuario + términos. */
    register: publicProcedure
      .input(registerInputSchema)
      .mutation(async ({ ctx, input }) => {
        const { user, sessionToken } = await service.register(input);
        issueSessionCookie(ctx, sessionToken);
        return { user };
      }),

    /** Login con anti fuerza bruta (CA de US-01). */
    login: publicProcedure.input(loginInputSchema).mutation(async ({ ctx, input }) => {
      const { user, sessionToken } = await service.login(input, { ip: ctx.ip });
      issueSessionCookie(ctx, sessionToken);
      return { user };
    }),

    /** Usuario activo (sesión). */
    me: protectedProcedure.query(({ ctx }) => toPublicUser(ctx.user)),
  });
}

/**
 * Router por defecto (producción): singletons de la app + parámetros por
 * env. Construcción perezosa para que importar el módulo (p. ej. por los
 * tipos) no exija el entorno.
 */
let defaultRouter: ReturnType<typeof createAuthRouter> | null = null;

export function getDefaultAuthRouter() {
  defaultRouter ??= (() => {
    const env = getServerEnv();
    return createAuthRouter({
      prisma,
      rateLimit: redisRateLimitStore,
      sessionTtlSec: env.SESSION_TTL_DAYS * 86_400,
      secureCookie: isSessionCookieSecure(),
      rateLimitCfg: {
        maxPerWindow: env.AUTH_RATE_LIMIT_MAX,
        windowSec: env.AUTH_RATE_LIMIT_WINDOW_SEC,
        lockoutThreshold: env.AUTH_LOCKOUT_THRESHOLD,
        lockoutSec: env.AUTH_LOCKOUT_SEC,
      },
    });
  })();
  return defaultRouter;
}
