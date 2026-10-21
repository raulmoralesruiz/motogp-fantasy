/**
 * Router de lineups (US-09, Fase 2, ADR-0017).
 *
 * Autorización: cualquier usuario autenticado compone y gestiona SUS
 * lineups (los procedimientos reciben el `userId` del contexto; nunca del
 * input). El cliente solo envía IDs de activos: coste y presupuesto se
 * recalculan siempre en el servidor (invariante 2).
 */
import type { PrismaClient } from "@prisma/client";

import { LineupService } from "@/modules/lineups";
import {
  confirmInjuryInputSchema,
  lineupGpIdInputSchema,
  saveLineupInputSchema,
} from "@/shared/validation/lineups";

import { prisma } from "../prisma";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export interface LineupsRouterDeps {
  prisma: PrismaClient;
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createLineupsRouter(deps: LineupsRouterDeps) {
  const service = new LineupService({ prisma: deps.prisma });

  return router({
    /** Lineup del usuario para un GP (null si aún no lo ha guardado). */
    get: protectedProcedure
      .input(lineupGpIdInputSchema)
      .query(({ ctx, input }) => service.get(input.gpId, ctx.user.id)),

    /**
     * Contexto del builder para un GP: GP + presupuesto del usuario
     * (US-10) + mercado con precios congelados.
     */
    builder: protectedProcedure
      .input(lineupGpIdInputSchema)
      .query(({ ctx, input }) => service.builder(input.gpId, ctx.user.id)),

    /**
     * Componer y guardar el lineup (US-09). El primer save no consume
     * cambios; los posteriores consumen la diferencia mínima y pueden
     * consumir exenciones al agotar los cambios del GP.
     */
    save: protectedProcedure
      .input(saveLineupInputSchema)
      .mutation(({ ctx, input }) =>
        service.save(input, { userId: ctx.user.id }),
      ),

    /**
     * Historial de cambios del usuario para un GP (US-12):
     * quién/cuándo/qué/coste antes-después.
     */
    history: protectedProcedure
      .input(lineupGpIdInputSchema)
      .query(({ ctx, input }) => service.history(input.gpId, ctx.user.id)),

    /**
     * Wildcard (US-12, ADR-0017): resetea el lineup completo sin consumir
     * cambios por GP. 1 por temporada.
     */
    wildcard: protectedProcedure
      .input(saveLineupInputSchema)
      .mutation(({ ctx, input }) =>
        service.applyWildcard(input, { userId: ctx.user.id }),
      ),

    /**
     * Confirmación de lesión por GP (US-12, ADR-0017): el admin confirma
     * que un piloto no estará en el GP → +1 cambio gratuito a cada usuario
     * que lo tenga en su lineup de ese GP.
     */
    confirmInjury: adminProcedure
      .input(confirmInjuryInputSchema)
      .mutation(({ ctx, input }) =>
        service.confirmInjury(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),
  });
}

let defaultRouter: ReturnType<typeof createLineupsRouter> | null = null;

export function getDefaultLineupsRouter() {
  defaultRouter ??= createLineupsRouter({ prisma });
  return defaultRouter;
}
