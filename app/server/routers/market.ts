/**
 * Router de mercado (US-06/US-07/US-08/US-14): pilotos, constructores,
 * equipos, afiliaciones por GP, precios (apertura P0 + histórico + fórmula +
 * ajuste manual) y exploración del mercado (lista + detalle por GP).
 *
 * Autorización (T-08, security.md §1.5):
 * - Mutaciones: solo `global_admin` (`adminProcedure`) — acciones sensibles
 *   con auditoría en la misma transacción (T-09).
 * - `list`/`get`/`history`/`market`: cualquier usuario autenticado
 *   (información pública del mercado).
 *
 * El constructor de una afiliación nunca lo envía el cliente: el servicio
 * lo deriva del equipo (invariante 5: constructor ≠ equipo).
 */
import type { PrismaClient } from "@prisma/client";

import { TRPCError } from "@trpc/server";

import type { MarketSource } from "@/modules/market";
import {
  MarketService,
  PriceService,
  PulseLiveMarketSource,
  MarketSourceError,
  MarketNormalizationError,
} from "@/modules/market";
import {
  applyFormulaInputSchema,
  createConstructorInputSchema,
  createRiderInputSchema,
  createTeamInputSchema,
  fetchMarketInputSchema,
  importMarketInputSchema,
  listAssetPricesInputSchema,
  marketDetailInputSchema,
  marketListInputSchema,
  p0HeuristicInputSchema,
  priceHistoryInputSchema,
  riderIdInputSchema,
  setManualPriceInputSchema,
  setOpeningPriceInputSchema,
  setRiderAffiliationFromInputSchema,
  setRiderAffiliationInputSchema,
} from "@/shared/validation/market";

import { prisma } from "../prisma";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export interface MarketRouterDeps {
  prisma: PrismaClient;
  /** Fuente de mercado (ADR-0013); por defecto PulseLive. */
  marketSource?: MarketSource;
}

/**
 * Fallos de la fuente de mercado (red, HTTP, normalización): el admin
 * necesita el motivo en español; el errorFormatter expone `message` para
 * todos los códigos, así que INTERNAL_SERVER_ERROR no oculta nada aquí.
 */
function toMarketTrpcError(error: unknown): never {
  if (
    error instanceof MarketSourceError ||
    error instanceof MarketNormalizationError
  ) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }
  throw error;
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createMarketRouter(deps: MarketRouterDeps) {
  const service = new MarketService({ prisma: deps.prisma });
  const priceService = new PriceService({ prisma: deps.prisma });
  const marketSource = deps.marketSource ?? new PulseLiveMarketSource();

  return router({
    /** Pilotos (US-06). */
    riders: router({
      /** Pilotos ordenados por nombre (cualquier usuario autenticado). */
      list: protectedProcedure.query(() => service.listRiders()),

      /** Piloto con sus afiliaciones por GP (cualquier usuario autenticado). */
      get: protectedProcedure
        .input(riderIdInputSchema)
        .query(({ input }) => service.getRider(input.riderId)),

      /**
       * Crea un piloto o reutiliza uno existente (unique `name`; solo la
       * creación nueva se audita — US-06, admin).
       */
      create: adminProcedure
        .input(createRiderInputSchema)
        .mutation(({ ctx, input }) =>
          service.createRider(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),
    }),

    /** Constructores (US-06). */
    constructors: router({
      /** Constructores ordenados por nombre (cualquier usuario autenticado). */
      list: protectedProcedure.query(() => service.listConstructors()),

      /**
       * Crea un constructor o reutiliza uno existente (unique `name`; solo
       * la creación nueva se audita — US-06, admin).
       */
      create: adminProcedure
        .input(createConstructorInputSchema)
        .mutation(({ ctx, input }) =>
          service.createConstructor(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),
    }),

    /** Equipos (US-06). */
    teams: router({
      /** Equipos ordenados por nombre, con su constructor (cualquier usuario autenticado). */
      list: protectedProcedure.query(() => service.listTeams()),

      /**
       * Crea un equipo o reutiliza uno existente (unique `name`; el
       * constructor debe existir; solo la creación nueva se audita —
       * US-06, admin).
       */
      create: adminProcedure
        .input(createTeamInputSchema)
        .mutation(({ ctx, input }) =>
          service.createTeam(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),
    }),

    /** Afiliaciones por GP (US-06, ADR-0013). */
    affiliations: router({
      /**
       * Asigna el equipo al piloto para un GP concreto (ajuste fino):
       * reemplaza la afiliación existente; el constructor se deriva del
       * equipo (US-06, admin, auditado before/after).
       */
      set: adminProcedure
        .input(setRiderAffiliationInputSchema)
        .mutation(({ ctx, input }) =>
          service.setRiderAffiliation(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),

      /**
       * Asigna el equipo "desde el GP X en adelante" (ADR-0013): rellena el
       * GP de inicio y los GPs siguientes de la temporada sin afiliación;
       * salta y reporta los existentes; nunca toca los anteriores
       * (US-06, admin, auditado + resumen).
       */
      setFrom: adminProcedure
        .input(setRiderAffiliationFromInputSchema)
        .mutation(({ ctx, input }) =>
          service.setRiderAffiliationFrom(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),
    }),

    /** Precios (US-07, ADR-0014). */
    prices: router({
      /**
       * Activos de un tipo con su precio de apertura P0 (null si no está
       * fijado), ordenados por nombre (cualquier usuario autenticado).
       */
      list: protectedProcedure
        .input(listAssetPricesInputSchema)
        .query(({ input }) => priceService.listAssetPrices(input)),

      /**
       * Histórico de precios de un activo: P0 + una fila por GP, orden
       * P0 → ronda (cualquier usuario autenticado).
       */
      history: protectedProcedure
        .input(priceHistoryInputSchema)
        .query(({ input }) => priceService.getPriceHistory(input)),

      /**
       * Fija el precio de apertura (P0) de un activo: upsert auditado
       * (ADR-0014); se puede cambiar en cualquier momento (auditado); el
       * gate de lockout para precios por GP es US-08 (admin).
       */
      setOpening: adminProcedure
        .input(setOpeningPriceInputSchema)
        .mutation(({ ctx, input }) =>
          priceService.setOpeningPrice(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),

      /**
       * Ajuste manual de precio de un activo para un GP concreto (US-08):
       * `reason = manual`, `createdBy = actor`, auditado before/after. El GP
       * no puede estar en lockout (gate US-08) (admin).
       */
      setManual: adminProcedure
        .input(setManualPriceInputSchema)
        .mutation(({ ctx, input }) =>
          priceService.setManualPrice(input, { actorId: ctx.user.id, ip: ctx.ip }),
        ),

      /**
       * Aplica la fórmula de precios v1 (`pricing-v1`) para un GP que acaba
       * de quedarse definitivo (US-08): calcula el precio del siguiente GP
       * para todos los activos con P0 y registra cada movimiento (motivo
       * `formula`). El GP objetivo no puede estar en lockout (gate US-08).
       * El disparo automático (job con lock por GP) llega con la fase de
       * resultados; aquí es el disparo manual del admin (admin).
       */
      applyFormula: adminProcedure
        .input(applyFormulaInputSchema)
        .mutation(({ input }) => priceService.applyFormulaForGp(input)),
    }),

    /** Exploración del mercado (US-14). */
    market: router({
      /**
       * Activos de un tipo en el GP elegido (cualquier usuario
       * autenticado): precio actual (precio del GP, con fallback a P0),
       * tendencia, mini-histórico y concentración (nº de lineups del GP
       * que contienen el activo, sin PII). Filtros: constructor/equipo
       * (solo riders) y rango de precio inclusivo.
       */
      list: protectedProcedure
        .input(marketListInputSchema)
        .query(({ input }) => priceService.listMarket(input)),

      /**
       * Detalle de un activo en el GP elegido (cualquier usuario
       * autenticado): vista del activo + histórico completo de precios.
       */
      detail: protectedProcedure
        .input(marketDetailInputSchema)
        .query(({ input }) => priceService.marketDetail(input)),

      /**
       * Descarga y normaliza el mercado del año desde la fuente
       * (preview, SIN escribir en BD). El resultado se reenvía a
       * `market.import`.
       */
      fetch: adminProcedure.input(fetchMarketInputSchema).query(async ({ input }) => {
        try {
          return await marketSource.fetchSeasonMarket(input.year);
        } catch (error) {
          toMarketTrpcError(error);
        }
      }),

      /**
       * Importa el mercado normalizado (revalidado server-side) en una
       * temporada: transacción atómica, salta lo que ya existe
       * (constructores, equipos, pilotos, afiliaciones) y audita
       * `market.imported` con resumen.
       */
      import: adminProcedure
        .input(importMarketInputSchema)
        .mutation(({ ctx, input }) =>
          service.importMarket(
            { normalized: input.market, seasonId: input.seasonId },
            { actorId: ctx.user.id, ip: ctx.ip },
          ),
        ),

      /**
       * P0 heurística desde la clasificación del campeonato (ADR-0014):
       * calcula los precios de apertura (P0) de todos los activos a partir
       * de la clasificación de la temporada (posición → precio lineal 30→10;
       * equipos/constructores = media de sus riders). Idempotente (re-ejecutar
       * actualiza los P0) y auditada (`price.p0_heuristic`). Requiere que el
       * mercado (activos + afiliaciones) esté importado antes (admin).
       */
      p0Heuristic: adminProcedure
        .input(p0HeuristicInputSchema)
        .mutation(async ({ ctx, input }) => {
          try {
            const season = await prisma.season.findUnique({
              where: { id: input.seasonId },
            });
            if (!season) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "La temporada no existe.",
              });
            }
            const standings = await marketSource.fetchStandings(season.year);
            return await service.calculateP0FromClassification(
              input.seasonId,
              standings,
              { actorId: ctx.user.id, ip: ctx.ip },
            );
          } catch (error) {
            toMarketTrpcError(error);
          }
        }),
    }),
  });
}

/**
 * Router por defecto (producción): singletons de la app. Construcción
 * perezosa para que importar el módulo (p. ej. por los tipos) no exija
 * el entorno.
 */
let defaultRouter: ReturnType<typeof createMarketRouter> | null = null;

export function getDefaultMarketRouter() {
  defaultRouter ??= createMarketRouter({ prisma });
  return defaultRouter;
}
