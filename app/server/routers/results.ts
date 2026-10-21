/**
 * Router de resultados (US-16, ADR-0018): importación manual de resultados
 * por evento (q2/sprint/race) + consultas de solo lectura para la UI de
 * admin.
 *
 * Autorización (T-08, security.md §1.5): todos los procedimientos son
 * `adminProcedure` — importar o corregir resultados es una acción sensible
 * (auditoría en la misma transacción, T-09). El recálculo y el flujo
 * provisional→definitivo llegan con US-18/US-19.
 */
import type { PrismaClient } from "@prisma/client";

import { ResultsService } from "@/modules/results";
import {
  eventResultsInputSchema,
  gpEventsInputSchema,
  importEventInputSchema,
} from "@/shared/validation/results";

import { prisma } from "../prisma";
import { adminProcedure, router } from "../trpc";

export interface ResultsRouterDeps {
  prisma: PrismaClient;
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createResultsRouter(deps: ResultsRouterDeps) {
  const service = new ResultsService({ prisma: deps.prisma });

  return router({
    /**
     * Importa (o corrige) los resultados de un evento (US-16, ADR-0018):
     * re-importar con los mismos valores es un no-op; con valores distintos
     * es una corrección con histórico y motivo obligatorio. El estado de
     * puntuación se deriva de `started`/`finished`; no se importa (admin).
     */
    importEvent: adminProcedure
      .input(importEventInputSchema)
      .mutation(({ ctx, input }) =>
        service.importEvent(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /**
     * Eventos de resultados del GP con su estado (q2/sprint/race; Q1 no es
     * un evento de resultados — ADR-0018) (admin).
     */
    gpEvents: adminProcedure
      .input(gpEventsInputSchema)
      .query(({ input }) => service.gpEvents(input)),

    /**
     * Filas actuales de un evento: valores + nombre del piloto + estado de
     * la fila (pre-carga de la UI de admin) (admin).
     */
    eventResults: adminProcedure
      .input(eventResultsInputSchema)
      .query(({ input }) => service.eventResults(input)),
  });
}

/**
 * Router por defecto (producción): singleton de la app. Construcción
 * perezosa para que importar el módulo (p. ej. por los tipos) no exija
 * el entorno.
 */
let defaultRouter: ReturnType<typeof createResultsRouter> | null = null;

export function getDefaultResultsRouter() {
  defaultRouter ??= createResultsRouter({ prisma });
  return defaultRouter;
}
