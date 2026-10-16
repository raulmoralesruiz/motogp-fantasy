/**
 * Router de temporadas (US-04): list, get, create, addRulesVersion.
 *
 * - `create`/`addRulesVersion`: solo `global_admin` (`adminProcedure`) —
 *   las reglas son una acción sensible (T-09: auditoría en la misma
 *   transacción, dentro del service).
 * - `list`/`get`: cualquier usuario autenticado (las reglas de temporada
 *   son información pública del juego).
 */
import type { PrismaClient } from "@prisma/client";

import { SeasonService } from "@/modules/seasons";
import {
  addRulesVersionInputSchema,
  createSeasonInputSchema,
  seasonIdInputSchema,
} from "@/shared/validation/seasons";

import { prisma } from "../prisma";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export interface SeasonsRouterDeps {
  prisma: PrismaClient;
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createSeasonsRouter(deps: SeasonsRouterDeps) {
  const service = new SeasonService({ prisma: deps.prisma });

  return router({
    /** Temporadas con sus versiones de reglas (cualquier usuario autenticado). */
    list: protectedProcedure.query(() => service.listSeasons()),

    /** Una temporada con sus versiones de reglas. */
    get: protectedProcedure
      .input(seasonIdInputSchema)
      .query(({ input }) => service.getSeason(input.seasonId)),

    /** Crea una temporada con su primera versión de reglas (US-04, admin). */
    create: adminProcedure
      .input(createSeasonInputSchema)
      .mutation(({ ctx, input }) =>
        service.createSeasonWithRules(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /** Añade una nueva versión de reglas a una temporada (US-04, admin). */
    addRulesVersion: adminProcedure
      .input(addRulesVersionInputSchema)
      .mutation(({ ctx, input }) =>
        service.addRulesVersion(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),
  });
}

/**
 * Router por defecto (producción): singletons de la app. Construcción
 * perezosa para que importar el módulo (p. ej. por los tipos) no exija
 * el entorno.
 */
let defaultRouter: ReturnType<typeof createSeasonsRouter> | null = null;

export function getDefaultSeasonsRouter() {
  defaultRouter ??= createSeasonsRouter({ prisma });
  return defaultRouter;
}
