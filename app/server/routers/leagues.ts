/**
 * Router de ligas (US-23, ADR-0023): creación de liga privada con código.
 *
 * Autorización (T-08, security.md §1.5):
 * - `create`: cualquier usuario autenticado (el actor es el creador y
 *   queda admin de su liga; el `userId` sale del contexto, nunca del
 *   input — AGENTS.md §8).
 * - `rotateCode`: solo el admin de la liga (revalida el servicio por
 *   recurso; un miembro recibe 403 FORBIDDEN).
 * - `get`: solo miembros activos (liga privada ⇒ NOT_FOUND para extraños,
 *   leagues.md §9); el código solo lo devuelve el admin.
 * - `myLeagues`: ligas activas del usuario.
 *
 * Rate limit de creación (security.md §1.6: "creación de ligas"): por
 * usuario, store inyectado (Redis en producción).
 */
import type { PrismaClient } from "@prisma/client";

import { LeagueService } from "@/modules/leagues";
import {
  createLeagueInputSchema,
  leagueIdInputSchema,
} from "@/shared/validation/leagues";

import { getServerEnv } from "../env";
import { prisma } from "../prisma";
import { redisRateLimitStore } from "../rate-limit-redis";
import { protectedProcedure, router } from "../trpc";

export interface LeaguesRouterDeps {
  prisma: PrismaClient;
  /** Rate limit de creación de ligas (US-23); opcional en tests. */
  rateLimit?: {
    recordLeagueCreation(
      userId: string,
      windowSec: number,
    ): Promise<{ count: number; remainingSec: number }>;
  };
  /** Configuración del rate limit de creación (US-23). */
  rateLimitCfg?: { maxPerWindow: number; windowSec: number };
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createLeaguesRouter(deps: LeaguesRouterDeps) {
  const service = new LeagueService({
    prisma: deps.prisma,
    rateLimit: deps.rateLimit,
    rateLimitCfg: deps.rateLimitCfg,
  });

  return router({
    /**
     * Crea una liga (US-23, leagues.md §3): el creador es admin; si el modo
     * de entrada lo requiere, se genera un código de alta entropía
     * (≥8 chars, sin 0/O/1/I). Auditoría `league.created`.
     */
    create: protectedProcedure
      .input(createLeagueInputSchema)
      .mutation(({ ctx, input }) =>
        service.createLeague(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /**
     * Rota el código de la liga (US-23, leagues.md §4): el código
     * anterior queda revocado. Solo el admin (leagues.md §5).
     */
    rotateCode: protectedProcedure
      .input(leagueIdInputSchema)
      .mutation(({ ctx, input }) =>
        service.rotateCode(input.leagueId, ctx.user.id, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /** Detalle de una liga (US-23): solo miembros activos; código solo admin. */
    get: protectedProcedure
      .input(leagueIdInputSchema)
      .query(({ ctx, input }) => service.getLeague(input.leagueId, ctx.user.id)),

    /** Ligas activas del usuario (US-23). */
    myLeagues: protectedProcedure.query(({ ctx }) => service.myLeagues(ctx.user.id)),
  });
}

/**
 * Router por defecto (producción): singletons de la app + parámetros por
 * env. Construcción perezosa para que importar el módulo (p. ej. por los
 * tipos) no exija el entorno.
 */
let defaultRouter: ReturnType<typeof createLeaguesRouter> | null = null;

export function getDefaultLeaguesRouter() {
  defaultRouter ??= (() => {
    const env = getServerEnv();
    return createLeaguesRouter({
      prisma,
      rateLimit: redisRateLimitStore,
      rateLimitCfg: {
        maxPerWindow: env.LEAGUE_CREATE_RATE_LIMIT_MAX,
        windowSec: env.LEAGUE_CREATE_RATE_LIMIT_WINDOW_SEC,
      },
    });
  })();
  return defaultRouter;
}
