/**
 * Router de temporadas (US-04, US-05): temporadas, circuitos, GPs,
 * eventos de fin de semana e import de calendario.
 *
 * Autorización (T-08, security.md §1.5):
 * - Mutaciones + `calendar.*`: solo `global_admin` (`adminProcedure`) —
 *   acciones sensibles con auditoría en la misma transacción (T-09).
 * - `list`/`get`: cualquier usuario autenticado (información pública del
 *   juego).
 *
 * `calendar.fetch` lee la fuente externa (PulseLive, ADR-0012) SIN escribir
 * en BD (preview); `calendar.import` revalida server-side y crea en una
 * transacción atómica.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

import {
  CalendarNormalizationError,
  CalendarSourceError,
  GpService,
  PulseLiveCalendarSource,
  SeasonService,
  type CalendarSource,
} from "@/modules/seasons";
import {
  addRulesVersionInputSchema,
  addWeekendEventInputSchema,
  createCircuitInputSchema,
  createGpInputSchema,
  createSeasonInputSchema,
  fetchCalendarInputSchema,
  gpIdInputSchema,
  importCalendarInputSchema,
  seasonIdInputSchema,
  updateGpLockoutInputSchema,
  updateGpStatusInputSchema,
} from "@/shared/validation/seasons";

import { prisma } from "../prisma";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export interface SeasonsRouterDeps {
  prisma: PrismaClient;
  /** Fuente de calendario (ADR-0012); por defecto PulseLive. */
  calendarSource?: CalendarSource;
}

/**
 * Fallos de la fuente de calendario (red, HTTP, normalización): el admin
 * necesita el motivo en español; el errorFormatter expone `message` para
 * todos los códigos, así que INTERNAL_SERVER_ERROR no oculta nada aquí.
 */
function toCalendarTrpcError(error: unknown): never {
  if (
    error instanceof CalendarSourceError ||
    error instanceof CalendarNormalizationError
  ) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }
  throw error;
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createSeasonsRouter(deps: SeasonsRouterDeps) {
  const service = new SeasonService({ prisma: deps.prisma });
  const gpService = new GpService({ prisma: deps.prisma });
  const calendarSource = deps.calendarSource ?? new PulseLiveCalendarSource();

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

    /** Circuitos (US-05). */
    circuits: router({
      /** Circuitos ordenados por país y nombre (cualquier usuario autenticado). */
      list: protectedProcedure.query(() => gpService.listCircuits()),

      /**
       * Crea un circuito o reutiliza uno existente (unique `(name, country)`;
       * solo la creación nueva se audita — US-05, admin).
       */
      create: adminProcedure
        .input(createCircuitInputSchema)
        .mutation(({ ctx, input }) =>
          gpService.createCircuit(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),
    }),

    /** GPs y eventos de fin de semana (US-05). */
    gps: router({
      /** GPs de una temporada con circuito y eventos (cualquier usuario autenticado). */
      list: protectedProcedure
        .input(seasonIdInputSchema)
        .query(({ input }) => gpService.listGps(input.seasonId)),

      /** Un GP con su circuito y eventos. */
      get: protectedProcedure
        .input(gpIdInputSchema)
        .query(({ input }) => gpService.getGp(input.gpId)),

      /**
       * Crea un GP con sus eventos (Q2 y carrera obligatorias; Q1 y sprint
       * opcionales) + `lockoutAt` opcional (US-05, admin).
       */
      create: adminProcedure
        .input(createGpInputSchema)
        .mutation(({ ctx, input }) =>
          gpService.createGp(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),

      /** Añade un evento que falta en un GP (Q1/sprint opcionales, US-05, admin). */
      addEvent: adminProcedure
        .input(addWeekendEventInputSchema)
        .mutation(({ ctx, input }) =>
          gpService.addWeekendEvent(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),

      /**
       * Cambia el estado del GP aplicando la tabla de transiciones
       * (`scheduled → locked → finished/cancelled`; US-05, admin, auditado).
       */
      updateStatus: adminProcedure
        .input(updateGpStatusInputSchema)
        .mutation(({ ctx, input }) =>
          gpService.updateGpStatus(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),

      /** Fija o borra `lockoutAt` (US-05, admin, auditado). */
      updateLockout: adminProcedure
        .input(updateGpLockoutInputSchema)
        .mutation(({ ctx, input }) =>
          gpService.updateGpLockout(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),
    }),

    /** Import de calendario en 2 pasos (US-05, ADR-0012, admin). */
    calendar: router({
      /**
       * Descarga y normaliza el calendario del año desde la fuente
       * (preview, SIN escribir en BD). El resultado se reenvía a
       * `calendar.import`.
       */
      fetch: adminProcedure.input(fetchCalendarInputSchema).query(async ({ input }) => {
        try {
          return await calendarSource.fetchSeasonCalendar(input.year);
        } catch (error) {
          toCalendarTrpcError(error);
        }
      }),

      /**
       * Importa el calendario normalizado (revalidado server-side) en una
       * temporada: transacción atómica, salta las rondas existentes
       * (informe, no error) y audita `calendar.imported` + `gp.created`
       * por GP.
       */
      import: adminProcedure
        .input(importCalendarInputSchema)
        .mutation(({ ctx, input }) =>
          gpService.importCalendar(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),
    }),
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
