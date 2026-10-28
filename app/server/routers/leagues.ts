/**
 * Router de ligas (US-23, ADR-0023; US-24, ADR-0024; US-25, ADR-0025;
 * US-26, ADR-0026): creación de liga privada con código + liga pública y
 * directorio + unión por código o entrada abierta + permisos de liga
 * (admin/miembro).
 *
 * Autorización (T-08, security.md §1.5):
 * - `create`: cualquier usuario autenticado (el actor es el creador y
 *   queda admin de su liga; el `userId` sale del contexto, nunca del
 *   input — AGENTS.md §8).
 * - `rotateCode` / `update` / `transferAdmin` / `kick` / `close` /
 *   `setMemberInvites`: solo el admin de la liga (US-26, leagues.md §5 —
 *   revalida el servicio por recurso con la regla pura `canManageLeague`;
 *   un miembro recibe 403 FORBIDDEN).
 * - `join`: cualquier usuario autenticado (US-25) — el actor sale del
 *   contexto; la elegibilidad (estado, modo de entrada, código, membresía,
 *   plaza) la revalida el servicio (AGENTS.md §8).
 * - `leave`: cualquier usuario autenticado (US-27) — el actor sale de la
 *   liga; el servicio revalida que es miembro activo y no es el admin
 *   (AGENTS.md §8).
 * - `get`: **pública** (US-24) — pública ⇒ cualquiera (autenticado o no);
 *   privada ⇒ solo miembros activos (extraños → NOT_FOUND, leagues.md §9);
 *   el código solo lo devuelve el admin (leagues.md §5).
 * - `ranking`: **pública** (US-24) — última versión publicada (US-21);
 *   misma regla de acceso que `get`; seudónimos, nunca PII (leagues.md §9).
 * - `listPublic`: **pública** (US-24) — directorio de ligas públicas
 *   activas (leagues.md §2).
 * - `myLeagues`: ligas activas del usuario.
 *
 * Rate limit de creación (security.md §1.6: "creación de ligas"): por
 * usuario; de unión (leagues.md §4/§10): ventana + bloqueo por IP. Store
 * inyectado (Redis en producción).
 */
import type { PrismaClient } from "@prisma/client";

import { LeagueJoinRateLimit, LeagueService } from "@/modules/leagues";
import {
  createLeagueInputSchema,
  joinLeagueInputSchema,
  kickMemberInputSchema,
  leagueIdInputSchema,
  leagueRankingInputSchema,
  setMemberInvitesInputSchema,
  transferAdminInputSchema,
  updateLeagueInputSchema,
} from "@/shared/validation/leagues";

import { getServerEnv } from "../env";
import { prisma } from "../prisma";
import { redisRateLimitStore } from "../rate-limit-redis";
import { protectedProcedure, publicProcedure, router } from "../trpc";

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
  /** Rate limit de unión a ligas (US-25); opcional en tests. */
  joinRateLimit?: LeagueJoinRateLimit;
  /** Configuración del rate limit de unión (US-25). */
  joinRateLimitCfg?: {
    maxPerWindow: number;
    windowSec: number;
    lockoutThreshold: number;
    lockoutSec: number;
  };
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createLeaguesRouter(deps: LeaguesRouterDeps) {
  const service = new LeagueService({
    prisma: deps.prisma,
    rateLimit: deps.rateLimit,
    rateLimitCfg: deps.rateLimitCfg,
    joinRateLimit: deps.joinRateLimit,
    joinRateLimitCfg: deps.joinRateLimitCfg,
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

    /**
     * Cambia la configuración de la liga (US-26, leagues.md §5): nombre /
     * descripción / visibilidad. Solo el admin (un miembro → 403).
     */
    update: protectedProcedure
      .input(updateLeagueInputSchema)
      .mutation(({ ctx, input }) =>
        service.updateLeague(input.leagueId, input, ctx.user.id, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /**
     * Transfiere el rol de admin a otro miembro (US-26, leagues.md §5).
     * Solo el admin (un miembro → 403); el destino debe ser miembro activo.
     */
    transferAdmin: protectedProcedure
      .input(transferAdminInputSchema)
      .mutation(({ ctx, input }) =>
        service.transferAdmin(input.leagueId, input.targetUserId, ctx.user.id, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /**
     * Expulsa a un miembro (US-26, leagues.md §5). Solo el admin (un
     * miembro → 403); el destino debe ser miembro activo (no a sí mismo).
     */
    kick: protectedProcedure
      .input(kickMemberInputSchema)
      .mutation(({ ctx, input }) =>
        service.kickMember(input.leagueId, input.targetUserId, ctx.user.id, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /**
     * Cierra la liga (US-26, leagues.md §5): pasa a `finished` (el
     * histórico se conserva). Solo el admin (un miembro → 403).
     */
    close: protectedProcedure
      .input(leagueIdInputSchema)
      .mutation(({ ctx, input }) =>
        service.closeLeague(input.leagueId, ctx.user.id, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /**
     * Habilita/deshabilita que los miembros vean/compartan el código de
     * invitación (US-26, leagues.md §5: "invitar solo si el admin lo
     * habilita"). Solo el admin (un miembro → 403).
     */
    setMemberInvites: protectedProcedure
      .input(setMemberInvitesInputSchema)
      .mutation(({ ctx, input }) =>
        service.setMemberInvites(input.leagueId, input.enabled, ctx.user.id, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /**
     * Sale el actor de la liga (US-27, ADR-0027, leagues.md §5/§11): solo un
     * miembro activo; el admin debe transferir primero el rol (→ 400). La
     * membresía pasa a `left` (soft delete; el histórico se conserva).
     */
    leave: protectedProcedure
      .input(leagueIdInputSchema)
      .mutation(({ ctx, input }) =>
        service.leaveLeague(input.leagueId, ctx.user.id, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /**
     * Se une el actor a una liga (US-25, leagues.md §4/§6, ADR-0025):
     * pública ⇒ entrada abierta por `leagueId`; privada ⇒ por `code` (el
     * código resuelve la liga). Validaciones server-side con motivo
     * explícito; rate-limit + bloqueo por IP (anti fuerza bruta);
     * transaccional (última plaza: solo uno entra).
     */
    join: protectedProcedure
      .input(joinLeagueInputSchema)
      .mutation(({ ctx, input }) =>
        service.joinLeague(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /**
     * Detalle de una liga (US-23/US-24, ADR-0024): pública ⇒ cualquiera
     * (autenticado o no); privada ⇒ solo miembros activos (extraños →
     * NOT_FOUND). El código solo lo devuelve el admin (leagues.md §5).
     */
    get: publicProcedure
      .input(leagueIdInputSchema)
      .query(({ ctx, input }) =>
        service.getLeague(input.leagueId, ctx.user?.id ?? null),
      ),

    /**
     * Ranking de una liga (US-24, leagues.md §8/§9): la última versión
     * publicada (US-21/ADR-0022), general o por GP. Misma regla de acceso
     * que el detalle: pública ⇒ cualquiera; privada ⇒ miembro activo.
     */
    ranking: publicProcedure
      .input(leagueRankingInputSchema)
      .query(({ ctx, input }) =>
        service.leagueRanking(
          input.leagueId,
          input.gpId ?? null,
          ctx.user?.id ?? null,
        ),
      ),

    /**
     * Directorio de ligas públicas (US-24, leagues.md §2): solo `type=public`
     * y `status=active`. Sin sesión: es público.
     */
    listPublic: publicProcedure.query(() => service.listPublic()),

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
      joinRateLimit: redisRateLimitStore,
      joinRateLimitCfg: {
        maxPerWindow: env.LEAGUE_JOIN_RATE_LIMIT_MAX,
        windowSec: env.LEAGUE_JOIN_RATE_LIMIT_WINDOW_SEC,
        lockoutThreshold: env.LEAGUE_JOIN_LOCKOUT_THRESHOLD,
        lockoutSec: env.LEAGUE_JOIN_LOCKOUT_SEC,
      },
    });
  })();
  return defaultRouter;
}
