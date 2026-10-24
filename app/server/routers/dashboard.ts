/**
 * Router de dashboard (US-15): próximo GP con cuenta atrás a lockout,
 * presupuesto disponible, coste del lineup, posición en cada liga y
 * avisos (recálculo, lockout).
 *
 * Composición de solo lectura de los servicios existentes (seasons,
 * lineups, leagues, results): no introduce reglas nuevas. El presupuesto
 * y el coste son los MISMOS que `lineups` valida (misma función pura,
 * invariante 2) y el estado de cierre usa el gate de US-13
 * (`status = locked ∨ now ≥ lockoutAt`), evaluado en el servidor.
 *
 * Autorización: cualquier usuario autenticado (ve solo sus datos: su
 * presupuesto, su lineup, sus ligas; los rankings son por `(league, user)`).
 */
import type { GpStatus, PrismaClient } from "@prisma/client";

import { LeagueService, type MyLeagueRanking } from "@/modules/leagues";
import {
  LineupService,
  type GpBudget,
  type LineupView,
} from "@/modules/lineups";
import { ResultsService } from "@/modules/results";
import { GpService } from "@/modules/seasons";

import { prisma } from "../prisma";
import { protectedProcedure, router } from "../trpc";

export type DashboardNoticeKind = "lockout" | "recalculo";
export type DashboardNoticeSeverity = "error" | "warning" | "info";

/** Aviso del dashboard (US-15): lockout del próximo GP o recálculo. */
export interface DashboardNotice {
  kind: DashboardNoticeKind;
  severity: DashboardNoticeSeverity;
  message: string;
  gpId: string;
  gpName: string;
  /** Fecha del lockout (kind `lockout`) o de la última corrección (`recalculo`). */
  at: Date | null;
}

/** Próximo GP del dashboard (US-15). */
export interface DashboardGpView {
  id: string;
  name: string;
  round: number;
  date: Date;
  status: GpStatus;
  lockoutAt: Date | null;
  circuit: { name: string; country: string };
  /**
   * Mismo gate que US-13, evaluado en el servidor: `status = locked ∨
   * now ≥ lockoutAt` → no se pueden guardar lineups.
   */
  closed: boolean;
}

/** Vista completa del dashboard (US-15). */
export interface DashboardView {
  season: { id: string; name: string; year: number } | null;
  /** Primer GP `scheduled` de la temporada más reciente (null si no hay). */
  nextGp: DashboardGpView | null;
  /** Presupuesto del usuario para el próximo GP (B + carry; US-10). */
  budget: GpBudget | null;
  /** Lineup guardado para el próximo GP (null si aún no se ha guardado). */
  lineup: LineupView | null;
  /** Posición en cada liga activa (nulls si US-19/US-21 aún no calculan). */
  leagues: MyLeagueRanking[];
  /** Avisos (lockout del próximo GP + recálculo), lockout primero. */
  notices: DashboardNotice[];
}

export interface DashboardRouterDeps {
  prisma: PrismaClient;
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createDashboardRouter(deps: DashboardRouterDeps) {
  const gpService = new GpService({ prisma: deps.prisma });
  const lineupService = new LineupService({ prisma: deps.prisma });
  const leagueService = new LeagueService({ prisma: deps.prisma });
  const resultsService = new ResultsService({ prisma: deps.prisma });

  return router({
    /**
     * Dashboard (US-15): próximo GP con cuenta atrás a lockout,
     * presupuesto disponible, coste del lineup, posición en cada liga y
     * avisos (recálculo, lockout).
     */
    get: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.user.id;
      const next = await gpService.nextGp();
      const season = next?.season ?? null;
      const gp = next?.gp ?? null;
      // Gate de cierre (US-13), evaluado en el servidor (AGENTS.md §8).
      const closed = gp
        ? gp.status === "locked" ||
          (gp.lockoutAt !== null && new Date() >= gp.lockoutAt)
        : false;

      // Sin GP programado no hay presupuesto ni lineup (US-10/US-09), pero
      // las ligas y los avisos de recálculo siguen siendo útiles.
      const [budget, lineup, leagues, recalcs] = await Promise.all([
        gp ? lineupService.budgetForGp(gp, userId) : Promise.resolve(null),
        gp ? lineupService.get(gp.id, userId) : Promise.resolve(null),
        leagueService.myRankings(userId, gp?.id ?? null),
        resultsService.recalculationNotices(userId),
      ]);

      const notices: DashboardNotice[] = [];
      if (gp) {
        if (closed) {
          notices.push({
            kind: "lockout",
            severity: "error",
            message: `El GP ${gp.name} está cerrado (lockout): no se pueden guardar lineups.`,
            gpId: gp.id,
            gpName: gp.name,
            at: gp.lockoutAt,
          });
        } else if (gp.lockoutAt !== null) {
          notices.push({
            kind: "lockout",
            severity: "warning",
            message: `Cierre de lineups (lockout) del GP ${gp.name} el ${gp.lockoutAt.toISOString()}.`,
            gpId: gp.id,
            gpName: gp.name,
            at: gp.lockoutAt,
          });
        }
      }
      for (const recalc of recalcs) {
        notices.push({
          kind: "recalculo",
          severity: "info",
          message: `Resultados actualizados en ${recalc.gpName} (${recalc.corrections} ${
            recalc.corrections === 1 ? "corrección" : "correcciones"
          }, última el ${recalc.lastAt.toISOString()}).`,
          gpId: recalc.gpId,
          gpName: recalc.gpName,
          at: recalc.lastAt,
        });
      }

      return {
        season,
        nextGp: gp
          ? {
              id: gp.id,
              name: gp.name,
              round: gp.round,
              date: gp.date,
              status: gp.status,
              lockoutAt: gp.lockoutAt,
              circuit: { name: gp.circuit.name, country: gp.circuit.country },
              closed,
            }
          : null,
        budget,
        lineup,
        leagues,
        notices,
      };
    }),
  });
}

let defaultRouter: ReturnType<typeof createDashboardRouter> | null = null;

export function getDefaultDashboardRouter() {
  defaultRouter ??= createDashboardRouter({ prisma });
  return defaultRouter;
}
