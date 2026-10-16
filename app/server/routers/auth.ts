/**
 * Router de autenticación (US-01 + US-02): register, login, me, logout,
 * requestReset, resetPassword.
 *
 * La cookie de sesión la monta el handler de tRPC
 * (`app/api/trpc/[trpc]/route.ts`) a partir de `ctx.pendingCookies`: la
 * construcción de la cookie es una función pura (modules/identity/sessions)
 * testable sin HTTP.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

import {
  AuthService,
  buildSessionCookie,
  clearSessionCookie,
  logEmailSender,
  toPublicUser,
  type EmailSender,
  type RateLimitStore,
} from "@/modules/identity";
import {
  loginInputSchema,
  registerInputSchema,
  requestResetInputSchema,
  resetPasswordInputSchema,
} from "@/shared/validation/auth";

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
  /** Enviador de emails (US-02; provisional: `logEmailSender`, ADR-0009). */
  emailSender: EmailSender;
  /** URL pública de la app para montar el link de recuperación (US-02). */
  appUrl: string;
  resetCfg: {
    tokenTtlSec: number;
    maxPerWindow: number;
    windowSec: number;
  };
  /**
   * Bootstrap de admin (T-08, ADR-0010): el registro con este email
   * recibe `global_admin`. Vacío/ausente → nadie lo recibe.
   */
  bootstrapAdminEmail?: string;
}

/** Router inyectable: los tests de integración lo montan con su propia BD y store. */
export function createAuthRouter(deps: AuthRouterDeps) {
  const service = new AuthService({
    prisma: deps.prisma,
    rateLimit: deps.rateLimit,
    emailSender: deps.emailSender,
    cfg: {
      ...deps.rateLimitCfg,
      sessionTtlSec: deps.sessionTtlSec,
      resetTokenTtlSec: deps.resetCfg.tokenTtlSec,
      resetMaxPerWindow: deps.resetCfg.maxPerWindow,
      resetWindowSec: deps.resetCfg.windowSec,
      appUrl: deps.appUrl,
      bootstrapAdminEmail: deps.bootstrapAdminEmail,
    },
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
        const { user, sessionToken } = await service.register(input, { ip: ctx.ip });
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

    /**
     * Cierre de sesión (US-02): revoca la sesión en BD (idempotente a nivel
     * de datos) y limpia la cookie. Sin sesión activa → UNAUTHORIZED.
     */
    logout: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.sessionToken) {
        // No puede pasar (protectedProcedure garantiza la sesión), pero el
        // tipo de contexto no lo sabe; se rechaza de forma explícita.
        throw new TRPCError({ code: "UNAUTHORIZED", message: "No estás autenticado" });
      }
      await service.logout(ctx.sessionToken);
      ctx.pendingCookies.push(clearSessionCookie(deps.secureCookie));
      return { ok: true };
    }),

    /**
     * Solicita un enlace de recuperación (US-02). Anti-enumeración: la
     * respuesta es idéntica exista o no el email.
     */
    requestReset: publicProcedure
      .input(requestResetInputSchema)
      .mutation(async ({ ctx, input }) =>
        service.requestPasswordReset(input.email, { ip: ctx.ip }),
      ),

    /**
     * Restablece la contraseña con el token del link (US-02). Token de uso
     * único con expiración; revoca todas las sesiones del usuario.
     */
    resetPassword: publicProcedure
      .input(resetPasswordInputSchema)
      .mutation(({ input }) => service.resetPassword(input.token, input.password)),
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
      emailSender: logEmailSender,
      appUrl: env.NEXT_PUBLIC_APP_URL,
      resetCfg: {
        tokenTtlSec: env.RESET_TOKEN_TTL_SEC,
        maxPerWindow: env.RESET_RATE_LIMIT_MAX,
        windowSec: env.RESET_RATE_LIMIT_WINDOW_SEC,
      },
      bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL || undefined,
    });
  })();
  return defaultRouter;
}
