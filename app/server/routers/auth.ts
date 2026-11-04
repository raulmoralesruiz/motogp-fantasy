/**
 * Router de autenticación (US-01 + US-02 + D-07): register, login,
 * verifyTotp (2FA), me, logout, requestReset, resetPassword y el sub-router
 * `totp` (enroll/confirm/disable).
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
  toTotpQrDataUrl,
  type EmailSender,
  type RateLimitStore,
  type TotpChallengeStore,
} from "@/modules/identity";
import { addLeagueMemberInTransaction } from "@/modules/leagues";
import {
  loginInputSchema,
  registerInputSchema,
  requestResetInputSchema,
  resetPasswordInputSchema,
  totpConfirmInputSchema,
  totpPasswordInputSchema,
  verifyTotpInputSchema,
} from "@/shared/validation/auth";

import { getServerEnv, isSessionCookieSecure } from "../env";
import { redisRateLimitStore } from "../rate-limit-redis";
import { redisTotpChallengeStore } from "../totp-redis";
import { prisma } from "../prisma";
import { publicProcedure, protectedProcedure, router, type Context } from "../trpc";

export interface AuthRouterDeps {
  prisma: PrismaClient;
  rateLimit: RateLimitStore;
  /**
   * Store de retos TOTP (D-07, ADR-0039): Redis en producción, in-memory en
   * tests (mismo patrón de inyección que `rateLimit`).
   */
  totp: TotpChallengeStore;
  /** 2FA TOTP (D-07, ADR-0039): parámetros operativos del reto. */
  totpCfg: {
    challengeTtlSec: number;
    maxAttempts: number;
  };
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
   * Rate limit de registro (T-12/ADR-0035, anti-flood de cuentas por IP).
   */
  registerCfg: {
    maxPerWindow: number;
    windowSec: number;
  };
  /**
   * Bootstrap de admin (T-08, ADR-0010): el registro con este email
   * recibe `global_admin`. Vacío/ausente → nadie lo recibe.
   */
  bootstrapAdminEmail?: string;
  /**
   * US-31: liga pública de bienvenida configurada por el servidor. Nunca viene
   * del payload del cliente; ausente = registro sin alta automática.
   */
  welcomeLeagueId?: string;
}

/** Router inyectable: los tests de integración lo montan con su propia BD y store. */
export function createAuthRouter(deps: AuthRouterDeps) {
  const welcomeLeagueId = deps.welcomeLeagueId;
  const service = new AuthService({
    prisma: deps.prisma,
    rateLimit: deps.rateLimit,
    totp: deps.totp,
    emailSender: deps.emailSender,
    cfg: {
      ...deps.rateLimitCfg,
      sessionTtlSec: deps.sessionTtlSec,
      resetTokenTtlSec: deps.resetCfg.tokenTtlSec,
      resetMaxPerWindow: deps.resetCfg.maxPerWindow,
      resetWindowSec: deps.resetCfg.windowSec,
      registerMaxPerWindow: deps.registerCfg.maxPerWindow,
      registerWindowSec: deps.registerCfg.windowSec,
      appUrl: deps.appUrl,
      bootstrapAdminEmail: deps.bootstrapAdminEmail,
      totpChallengeTtlSec: deps.totpCfg.challengeTtlSec,
      totpMaxAttempts: deps.totpCfg.maxAttempts,
    },
    onRegistered: welcomeLeagueId
      ? (tx, user, meta) =>
          addLeagueMemberInTransaction(tx, {
            leagueId: welcomeLeagueId,
            userId: user.id,
            actorId: user.id,
            ip: meta.ip,
            via: "welcome",
          })
      : undefined,
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

    /**
     * Login con anti fuerza bruta (CA de US-01). Cuenta con 2FA activo
     * (D-07, ADR-0039): respuesta con `totpRequired` + reto y SIN cookie de
     * sesión; la sesión se emite en `verifyTotp`.
     */
    login: publicProcedure.input(loginInputSchema).mutation(async ({ ctx, input }) => {
      const result = await service.login(input, { ip: ctx.ip });
      if (result.sessionToken) issueSessionCookie(ctx, result.sessionToken);
      return result;
    }),

    /**
     * Segundo factor (D-07, ADR-0039): canjea el código TOTP por sesión.
     * Solo se emite la cookie de sesión si el código es válido; los fallos
     * gastan el presupuesto del reto y alimentan el bloqueo por cuenta.
     */
    verifyTotp: publicProcedure
      .input(verifyTotpInputSchema)
      .mutation(async ({ ctx, input }) => {
        const { user, sessionToken } = await service.verifyTotp(
          input.token,
          input.code,
          { ip: ctx.ip },
        );
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

    /**
     * 2FA TOTP (D-07, ADR-0039): matriculación y gestión. Todos los
     * procedimientos exigen sesión; la matriculación y la desactivación
     * además re-autentican con la contraseña (operaciones sensibles).
     * Recomendado para `global_admin` (security.md §5).
     */
    totp: router({
      /**
       * Genera el secreto y muestra el QR (estado PENDIENTE hasta
       * `confirm`). `qrDataUrl`: SVG generado server-side (la URI lleva el
       * secreto: no sale a servicios externos).
       */
      enroll: protectedProcedure
        .input(totpPasswordInputSchema)
        .mutation(async ({ ctx, input }) => {
          const { secret, otpauthUri } = await service.enrollTotp(
            ctx.user.id,
            input.password,
            { ip: ctx.ip },
          );
          const qrDataUrl = await toTotpQrDataUrl(otpauthUri);
          return { secret, otpauthUri, qrDataUrl };
        }),

      /** Confirma la matriculación con un código de la app (activa el 2FA). */
      confirm: protectedProcedure
        .input(totpConfirmInputSchema)
        .mutation(({ ctx, input }) =>
          service.confirmTotp(ctx.user.id, input.code, { ip: ctx.ip }),
        ),

      /** Desactiva el 2FA (re-autenticación; borra secreto y activación). */
      disable: protectedProcedure
        .input(totpPasswordInputSchema)
        .mutation(({ ctx, input }) =>
          service.disableTotp(ctx.user.id, input.password, { ip: ctx.ip }),
        ),
    }),
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
      totp: redisTotpChallengeStore,
      totpCfg: {
        challengeTtlSec: env.TOTP_CHALLENGE_TTL_SEC,
        maxAttempts: env.TOTP_MAX_ATTEMPTS,
      },
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
      registerCfg: {
        maxPerWindow: env.AUTH_REGISTER_RATE_LIMIT_MAX,
        windowSec: env.AUTH_REGISTER_RATE_LIMIT_WINDOW_SEC,
      },
      bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL || undefined,
      welcomeLeagueId: env.WELCOME_LEAGUE_ID || undefined,
    });
  })();
  return defaultRouter;
}
