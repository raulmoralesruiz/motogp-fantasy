/**
 * Router de resultados (US-16, ADR-0018; US-17, ADR-0019): importación
 * manual de resultados por evento (q2/sprint/race), auto-import desde la
 * fuente (PulseLive) + link/unlink de GP, mapeo de pilotos y consultas de
 * solo lectura para la UI de admin.
 *
 * Autorización (T-08, security.md §1.5): los procedimientos de importación
 * y gestión son `adminProcedure` — importar o corregir resultados es una
 * acción sensible (auditoría en la misma transacción, T-09). `myScore`
 * (US-20) es `protectedProcedure`: el usuario ve su propia puntuación.
 *
 * US-18 (ADR-0020): marcar definitivo (primer recálculo rv-1 inline),
 * cancelar/neutralizar evento y estado derivado del GP. US-19 (ADR-0021):
 * recálculo auditable por corrección (nueva `results_version`). US-20:
 * `myScore` (mi puntuación con desglose).
 *
 * El auto-import (botón admin) usa la misma semántica que el job:
 * `source: "auto"`, `actorId = null` en la auditoría (los valores vienen de
 * la fuente, no del admin; ADR-0019).
 */
import type { PrismaClient } from "@prisma/client";

import {
  PulseLiveResultsSource,
  PulseLiveSourceError,
  ResultsService,
  type EventRefResolution,
  type EventRefResolver,
  type ResultsSource,
  type SourceEventCatalog,
} from "@/modules/results";
import {
  deleteRiderMappingInputSchema,
  eventFlagInputSchema,
  eventResultsInputSchema,
  gpEventsInputSchema,
  importEventInputSchema,
  importFromSourceInputSchema,
  linkSourceInputSchema,
  markDefinitiveInputSchema,
  myScoreInputSchema,
  setRiderMappingInputSchema,
  sourceEventsInputSchema,
  sourceStateInputSchema,
  unlinkSourceInputSchema,
} from "@/shared/validation/results";

import { prisma } from "../prisma";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export interface ResultsRouterDeps {
  prisma: PrismaClient;
  /**
   * Fuente de resultados + catálogo de eventos (US-17, ADR-0019). Si no se
   * inyecta, los procedimientos de auto-import se rechazan con un error
   * explícito (el servicio lo gestiona).
   */
  source?: ResultsSource & SourceEventCatalog;
}

/**
 * Resuelve el vínculo GP ↔ evento de la fuente para el adapter (DI,
 * ADR-0019): el adapter no toca la BD; la capa de router lo implementa.
 * `eventRef = null` → el GP no está vinculado (el adapter lanza
 * `SourceNotLinkedError`).
 */
export function createEventRefResolver(db: PrismaClient): EventRefResolver {
  return async (gpId: string): Promise<EventRefResolution | null> => {
    const gp = await db.gp.findUnique({
      where: { id: gpId },
      select: {
        name: true,
        sourceRef: true,
        season: { select: { year: true } },
      },
    });
    if (!gp) {
      throw new PulseLiveSourceError("El GP no existe.");
    }
    return {
      seasonYear: gp.season.year,
      eventRef: gp.sourceRef,
      gpName: gp.name,
    };
  };
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createResultsRouter(deps: ResultsRouterDeps) {
  const source = deps.source;
  const service = new ResultsService({
    prisma: deps.prisma,
    source,
    eventCatalog: source,
  });

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

    /**
     * Auto-import de un evento desde la fuente (US-17, ADR-0019): misma
     * semántica que el job (`source: "auto"`, `actorId = null` en la
     * auditoría). El GP debe estar vinculado (`linkSource`) y las filas
     * manuales nunca se tocan (manuales ganan al auto).
     */
    importFromSource: adminProcedure
      .input(importFromSourceInputSchema)
      .mutation(({ input }) =>
        service.importEventFromSource(input.gpId, input.event),
      ),

    /**
     * Vincula un GP a un evento de la fuente (`Gp.sourceRef`, ADR-0019).
     * Con `eventRef` explícito o, si se omite, match único por nombre
     * normalizado contra el catálogo de la temporada (0 o >1 candidatos →
     * error con la lista). Auditado.
     */
    linkSource: adminProcedure
      .input(linkSourceInputSchema)
      .mutation(({ ctx, input }) =>
        service.linkSource(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /**
     * Desvincula un GP de la fuente (`Gp.sourceRef = null`, ADR-0019).
     * Auditado.
     */
    unlinkSource: adminProcedure
      .input(unlinkSourceInputSchema)
      .mutation(({ ctx, input }) =>
        service.unlinkSource(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /**
     * Asocia un piloto de la fuente a un piloto del mercado
     * (`rider_mappings`, ADR-0019). Auditado.
     */
    setRiderMapping: adminProcedure
      .input(setRiderMappingInputSchema)
      .mutation(({ ctx, input }) =>
        service.setRiderMapping(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /**
     * Elimina la asociación de un piloto de la fuente (ADR-0019). Auditado.
     */
    deleteRiderMapping: adminProcedure
      .input(deleteRiderMappingInputSchema)
      .mutation(({ ctx, input }) =>
        service.deleteRiderMapping(input, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /**
     * Estado operativo del auto-import del GP: fallos consecutivos, último
     * error y pilotos sin mapear (por evento) (admin, US-17).
     */
    sourceState: adminProcedure
      .input(sourceStateInputSchema)
      .query(({ input }) => service.sourceState(input)),

    /**
     * Catálogo de eventos de la fuente de la temporada del GP (para el
     * selector de `linkSource`) (admin, US-17).
     */
    sourceEvents: adminProcedure
      .input(sourceEventsInputSchema)
      .query(({ input }) => service.sourceEvents(input)),

    /**
     * Mapeos de pilotos de la fuente vigentes (admin, US-17).
     */
    riderMappings: adminProcedure.query(() => service.riderMappings()),

    /**
     * Marcar el GP como definitivo (US-18, ADR-0020): voltea las filas
     * `provisional`/`corrected` a `definitive` y ejecuta el primer
     * recálculo (rv-1) en la misma transacción. Auditado; no-op (sin
     * auditoría) si el GP ya era definitivo.
     */
    markDefinitive: adminProcedure
      .input(markDefinitiveInputSchema)
      .mutation(({ ctx, input }) =>
        service.markDefinitive(input.gpId, { actorId: ctx.user.id, ip: ctx.ip }),
      ),

    /**
     * Cancelar un evento de resultados del GP (US-18, ADR-0020): el evento
     * no puntúa (0 para todos; scoring.md §6). Auditado; no-op si ya estaba
     * cancelado.
     */
    cancelEvent: adminProcedure
      .input(eventFlagInputSchema)
      .mutation(({ ctx, input }) =>
        service.cancelEvent(input.gpId, input.eventId, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /**
     * Neutralizar un evento de resultados del GP (US-18, ADR-0020): flag de
     * metadatos (se puntúa con el resultado oficial declarado). Auditado;
     * no-op si ya estaba neutralizado.
     */
    neutralizeEvent: adminProcedure
      .input(eventFlagInputSchema)
      .mutation(({ ctx, input }) =>
        service.neutralizeEvent(input.gpId, input.eventId, {
          actorId: ctx.user.id,
          ip: ctx.ip,
        }),
      ),

    /**
     * Estado de definitivo de un GP (US-18, ADR-0020): derivado de las filas
     * (definitivo = sin filas `provisional`) + `resultsVersion` + conteos.
     */
    gpState: adminProcedure
      .input(gpEventsInputSchema)
      .query(({ input }) => service.gpState(input.gpId)),

    /**
     * Mi puntuación en un GP con el desglose (US-20): por piloto (Q2/sprint/
     * GP/bonos/penalizaciones), constructor y equipo, con pesos oro/plata.
     * Solo lectura; el usuario ve su propia puntuación (ctx.user.id).
     */
    myScore: protectedProcedure
      .input(myScoreInputSchema)
      .query(({ ctx, input }) => service.myScore(input.gpId, ctx.user.id)),
  });
}

/**
 * Router por defecto (producción): singleton de la app. Construcción
 * perezosa para que importar el módulo (p. ej. por los tipos) no exija
 * el entorno.
 */
let defaultRouter: ReturnType<typeof createResultsRouter> | null = null;

export function getDefaultResultsRouter() {
  defaultRouter ??= createResultsRouter({
    prisma,
    source: new PulseLiveResultsSource({
      eventRefResolver: createEventRefResolver(prisma),
    }),
  });
  return defaultRouter;
}
