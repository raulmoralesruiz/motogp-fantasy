/**
 * Servicio de precios (US-07/US-08, ADR-0014): precios de apertura (P0),
 * histórico, fórmula por GP (pricing-v1) y ajuste manual.
 *
 * - `setOpeningPrice`: upsert auditado (ADR-0014) — si no existe, crea
 *   (auditoría `price.opening_set` con before=null); si existe con el mismo
 *   valor, no-op sin auditar; si existe con otro valor, lo actualiza
 *   (before/after). P0 se puede fijar o cambiar en cualquier momento
 *   (auditado).
 * - `applyFormulaForGp` (US-08): tras un GP definitivo, calcula el precio
 *   del siguiente GP para cada activo con P0 (fórmula pura
 *   `economy/pricing.ts`, pricing-v1) y escribe filas `reason = formula`,
 *   `rulesVersion = pricing-v1`, `createdBy = null` (sistema). Idempotente
 *   (mismo valor → no-op; valor distinto → corrección auditada
 *   `price.formula_recompute`). Gate de lockout: no toca el GP objetivo si
 *   está `locked`.
 * - `setManualPrice` (US-08): el admin fija/cambia el precio de un activo
 *   para un GP concreto. `reason = manual`, `createdBy = actor`, auditado
 *   (`price.manual_set`). Gate de lockout evaluado dentro de la
 *   transacción: GP `locked` → rechazado sin tocar la BD.
 * - `listAssetPrices`: activos + P0 actual (o null) para el panel admin.
 * - `getPriceHistory`: P0 + una fila por GP, orden P0 → ronda (lectura
 *   pública).
 *
 * Fila de P0: `gpId = null`, `reason = manual`, `createdBy = actor`,
 * `rulesVersion = null` (no la produce una fórmula).
 *
 * Fuente de `puntos(r)` de la fórmula: resultados **definitivos** de la
 * carrera principal (`race`) de los GPs r, r−1, r−2. Piloto: puntos por
 * posición (scoring-v1 + bono ganador). Constructor/equipo: media top-2 de
 * sus pilotos afiliados en ese GP (ADR-0013). Sin resultado/posición → 0
 * (DNF/baja → perf 0, la fórmula topa a [0,100]).
 */
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import {
  PMAX_GROUP,
  PMAX_RIDER,
  PRICING_VERSION,
  computeNextPrice,
  perf,
} from "@/modules/economy";
import {
  WINNER_BONUS,
  groupTopTwoAverage,
  mainRacePositionPoints,
} from "@/modules/scoring";
import type { AssetType } from "@/shared/validation/market";

import type { AuditMeta } from "./market-service";

export interface PriceServiceDeps {
  prisma: PrismaClient;
}

// ── Inputs (contratos del servicio; el router pasa los datos parseados por Zod) ──

export interface ListAssetPricesInput {
  assetType: AssetType;
}

export interface SetOpeningPriceInput {
  assetType: AssetType;
  assetId: string;
  price: number;
}

export interface PriceHistoryInput {
  assetType: AssetType;
  assetId: string;
}

/**
 * Aplicar la fórmula a un GP definitivo (US-08): `gpId` es el GP r que
 * acaba de cerrarse definitivamente; la fórmula escribe el precio del
 * siguiente GP de la temporada (r+1).
 */
export interface ApplyFormulaForGpInput {
  gpId: string;
}

/** Ajuste manual de precio de un activo para un GP concreto (US-08). */
export interface SetManualPriceInput {
  assetType: AssetType;
  assetId: string;
  gpId: string;
  price: number;
}

// ── Vistas ──

/** Activo con su precio de apertura (P0) (null si no está fijado). */
export interface AssetPriceView {
  assetId: string;
  name: string;
  openingPrice: number | null;
}

/** Fila del histórico de precios: P0 (gpRound/gpName null) o por GP. */
export interface PriceHistoryRow {
  id: string;
  gpRound: number | null;
  gpName: string | null;
  price: number;
  reason: "formula" | "manual";
  createdAt: Date;
}

/** Resultado de fijar P0: nueva ("created"), sustituida ("updated") o no-op ("unchanged"). */
export interface SetOpeningPriceResult {
  price: number;
  status: "created" | "updated" | "unchanged";
}

/** Resultado de aplicar la fórmula a un GP (US-08). */
export interface ApplyFormulaForGpResult {
  /** GP objetivo (r+1) al que se escribió el precio; null si no hay siguiente. */
  targetGpId: string | null;
  targetGpRound: number | null;
  /** Filas creadas. */
  created: number;
  /** Filas actualizadas (valor distinto: corrección de la fórmula). */
  updated: number;
  /** Filas que ya tenían el mismo valor (no-op, idempotencia). */
  unchanged: number;
  /** Activos sin P0 (la fórmula no se puede aplicar). */
  skippedNoOpening: number;
  /** true si el GP objetivo estaba en lockout y no se tocó nada. */
  skippedLocked: boolean;
}

/** Resultado de un ajuste manual (US-08). */
export interface SetManualPriceResult {
  price: number;
  status: "created" | "updated" | "unchanged";
}

// ── Utilidades ──

/** Violación de unique de Prisma (P2002): creación concurrente. */
function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Mensaje NOT_FOUND por tipo de activo (español). */
function assetNotFoundMessage(assetType: AssetType): string {
  switch (assetType) {
    case "rider":
      return "El piloto no existe.";
    case "constructor":
      return "El constructor no existe.";
    case "team":
      return "El equipo no existe.";
  }
}

/** Redondeo a 2 decimales (los precios son Decimal(10,2) en la BD). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Clave compuesta de activo (tipo + id) para los mapas de precios. */
function assetKey(assetType: AssetType, assetId: string): string {
  return `${assetType}:${assetId}`;
}

export class PriceService {
  constructor(private readonly deps: PriceServiceDeps) {}

  /**
   * Fija el precio de apertura (P0) de un activo (US-07, ADR-0014):
   * upsert auditado.
   * - El activo debe existir (NOT_FOUND).
   * - Si no existe: crea (auditoría `price.opening_set` con before=null).
   * - Si existe con el mismo valor: no-op sin auditar (no es un cambio).
   * - Si existe con otro valor: lo actualiza (before/after).
   * - P0 se puede cambiar en cualquier momento (auditado); el gate de
   *   lockout es US-08.
   */
  async setOpeningPrice(
    input: SetOpeningPriceInput,
    meta: AuditMeta,
  ): Promise<SetOpeningPriceResult> {
    const asset = await this.findAsset(input.assetType, input.assetId);
    if (!asset) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: assetNotFoundMessage(input.assetType),
      });
    }

    const run = async (tx: Prisma.TransactionClient) => {
      // `findFirst` (no `findUnique`): el `where` compuesto de Prisma no
      // acepta `gpId: null`; el índice parcial único garantiza ≤1 fila.
      const existing = await tx.price.findFirst({
        where: {
          assetType: input.assetType,
          assetId: input.assetId,
          gpId: null,
        },
      });
      const afterData = {
        assetType: input.assetType,
        assetId: input.assetId,
        price: input.price,
      };
      if (existing) {
        // Mismo valor → no-op, sin auditar.
        if (Number(existing.price) === input.price) {
          return { price: input.price, status: "unchanged" as const };
        }
        const updated = await tx.price.update({
          where: { id: existing.id },
          data: {
            price: input.price,
            reason: "manual",
            createdBy: meta.actorId,
          },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "price.opening_set",
          entity: "price",
          entityId: updated.id,
          beforeData: { price: Number(existing.price) },
          afterData,
          ip: meta.ip,
        });
        return { price: input.price, status: "updated" as const };
      }
      const created = await tx.price.create({
        data: {
          assetType: input.assetType,
          assetId: input.assetId,
          gpId: null,
          price: input.price,
          reason: "manual",
          rulesVersion: null,
          createdBy: meta.actorId,
        },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "price.opening_set",
        entity: "price",
        entityId: created.id,
        beforeData: null,
        afterData,
        ip: meta.ip,
      });
      return { price: input.price, status: "created" as const };
    };

    try {
      return await this.deps.prisma.$transaction(run);
    } catch (error) {
      // Creación concurrente sobre el índice parcial único de P0: la
      // re-ejecución reevalúa (sustituye o no-op).
      if (isPrismaUniqueViolation(error)) {
        return await this.deps.prisma.$transaction(run);
      }
      throw error;
    }
  }

  /**
   * Activos de un tipo con su precio de apertura (P0) (null si no está
   * fijado), ordenados por nombre. Lectura del panel admin.
   */
  async listAssetPrices(
    input: ListAssetPricesInput,
  ): Promise<AssetPriceView[]> {
    const [assets, prices] = await Promise.all([
      this.listAssets(input.assetType),
      this.deps.prisma.price.findMany({
        where: { assetType: input.assetType, gpId: null },
      }),
    ]);
    const p0 = new Map(prices.map((p) => [p.assetId, Number(p.price)]));
    return assets.map((asset) => ({
      assetId: asset.id,
      name: asset.name,
      openingPrice: p0.get(asset.id) ?? null,
    }));
  }

  /**
   * Histórico de precios de un activo (US-07): P0 + una fila por GP,
   * orden P0 → ronda. Lectura pública.
   */
  async getPriceHistory(
    input: PriceHistoryInput,
  ): Promise<PriceHistoryRow[]> {
    const asset = await this.findAsset(input.assetType, input.assetId);
    if (!asset) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: assetNotFoundMessage(input.assetType),
      });
    }
    const rows = await this.deps.prisma.price.findMany({
      where: { assetType: input.assetType, assetId: input.assetId },
      include: { gp: { select: { round: true, name: true } } },
    });
    // P0 (gpId null) primero, luego por ronda de GP.
    rows.sort((a, b) => {
      if (a.gpId === null) return -1;
      if (b.gpId === null) return 1;
      return a.gp!.round - b.gp!.round;
    });
    return rows.map((row) => ({
      id: row.id,
      gpRound: row.gp?.round ?? null,
      gpName: row.gp?.name ?? null,
      price: Number(row.price),
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Aplica la fórmula de precios (pricing-v1, US-08) a un GP definitivo:
   * calcula el precio del **siguiente** GP de la temporada (r+1) para cada
   * activo con P0 y escribe las filas `reason = formula`,
   * `rulesVersion = pricing-v1`, `createdBy = null` (sistema).
   *
   * - `puntos(r)` de los GPs r, r−1, r−2: resultados definitivos de la
   *   carrera principal (ver cabecera del archivo).
   * - Idempotencia: fila existente con el mismo valor → no-op; con otro
   *   valor (corrección de resultados) → update + auditoría
   *   `price.formula_recompute` (actor = sistema, before/after).
   * - Gate de lockout: si el GP objetivo (r+1) está `locked`, no se toca
   *   nada (CA US-08).
   * - Sin siguiente GP (último de la temporada) → no-op con
   *   `targetGpId = null`.
   * - GP r sin resultados definitivos → PRECONDITION_FAILED (el job corre
   *   tras el cierre definitivo).
   */
  async applyFormulaForGp(
    input: ApplyFormulaForGpInput,
  ): Promise<ApplyFormulaForGpResult> {
    const run = async (tx: Prisma.TransactionClient) => {
      const gp = await tx.gp.findUnique({ where: { id: input.gpId } });
      if (!gp) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "El GP no existe.",
        });
      }
      const next = await tx.gp.findUnique({
        where: {
          seasonId_round: { seasonId: gp.seasonId, round: gp.round + 1 },
        },
      });
      if (!next) {
        return {
          targetGpId: null,
          targetGpRound: null,
          created: 0,
          updated: 0,
          unchanged: 0,
          skippedNoOpening: 0,
          skippedLocked: false,
        };
      }
      // Gate de lockout: el GP objetivo está cerrado → no tocar la BD.
      if (next.status === "locked") {
        return {
          targetGpId: next.id,
          targetGpRound: next.round,
          created: 0,
          updated: 0,
          unchanged: 0,
          skippedNoOpening: 0,
          skippedLocked: true,
        };
      }
      // GP r debe tener resultados definitivos (el job corre tras el cierre).
      const hasDefinitive = await this.gpHasDefinitiveRaceResults(
        tx,
        gp.id,
      );
      if (!hasDefinitive) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "El GP no tiene resultados definitivos; la fórmula se aplica tras el cierre definitivo del GP.",
        });
      }
      // GPs fuente: r, r−1, r−2 (solo los que existen en la temporada).
      const sourceRounds = [gp.round, gp.round - 1, gp.round - 2].filter(
        (round) => round >= 1,
      );
      const sourceGps = await tx.gp.findMany({
        where: { seasonId: gp.seasonId, round: { in: sourceRounds } },
      });
      const gpByRound = new Map(sourceGps.map((g) => [g.round, g]));

      // Puntos de cada piloto por GP (carrera principal, definitivos).
      const pointsByGp = new Map<string, Map<string, number>>();
      for (const sGp of sourceGps) {
        pointsByGp.set(sGp.id, await this.raceRiderPoints(tx, sGp.id));
      }

      // Afiliaciones por GP (ADR-0013): riderId → constructor/equipo.
      const affiliations = await tx.riderAffiliation.findMany({
        where: { gpId: { in: sourceGps.map((g) => g.id) } },
      });
      const affByGp = new Map<
        string,
        Map<string, { constructorId: string; teamId: string }>
      >();
      for (const aff of affiliations) {
        const m = affByGp.get(aff.gpId) ?? new Map();
        m.set(aff.riderId, {
          constructorId: aff.constructorId,
          teamId: aff.teamId,
        });
        affByGp.set(aff.gpId, m);
      }

      // Puntos de grupo (media top-2) por GP, para constructores y equipos.
      const ctorPointsByGp = new Map<string, Map<string, number>>();
      const teamPointsByGp = new Map<string, Map<string, number>>();
      for (const sGp of sourceGps) {
        const riderPts = pointsByGp.get(sGp.id) ?? new Map<string, number>();
        const aff = affByGp.get(sGp.id) ?? new Map<string, unknown>();
        const riderPoints = [...riderPts.entries()]
          .filter(([riderId]) => aff.has(riderId))
          .map(([riderId, points]) => ({ riderId, points }));
        ctorPointsByGp.set(
          sGp.id,
          groupTopTwoAverage(
            riderPoints,
            (riderId) =>
              (aff.get(riderId) as { constructorId: string })
                .constructorId,
          ),
        );
        teamPointsByGp.set(
          sGp.id,
          groupTopTwoAverage(
            riderPoints,
            (riderId) =>
              (aff.get(riderId) as { teamId: string }).teamId,
          ),
        );
      }

      // Precios: P0 (gpId null), del GP objetivo y del GP r (previo).
      const [p0Rows, nextRows, prevRows] = await Promise.all([
        tx.price.findMany({ where: { gpId: null } }),
        tx.price.findMany({ where: { gpId: next.id } }),
        tx.price.findMany({ where: { gpId: gp.id } }),
      ]);
      const p0ByAsset = new Map(
        p0Rows.map((p) => [assetKey(p.assetType, p.assetId), Number(p.price)]),
      );
      const nextByAsset = new Map(
        nextRows.map((p) => [assetKey(p.assetType, p.assetId), p]),
      );
      const prevByAsset = new Map(
        prevRows.map((p) => [
          assetKey(p.assetType, p.assetId),
          Number(p.price),
        ]),
      );
      // Grid del GP objetivo (afiliaciones por GP, ADR-0013): la fórmula
      // solo fija precios a los activos que corren en ese GP. Sin grid → no-op
      // (el admin fija el grid y re-ejecuta; la fórmula es idempotente).
      const grid = await tx.riderAffiliation.findMany({
        where: { gpId: next.id },
      });
      const riderIds = new Set(grid.map((a) => a.riderId));
      const ctorIds = new Set(grid.map((a) => a.constructorId));
      const teamIds = new Set(grid.map((a) => a.teamId));
      const assets: Array<{ type: AssetType; id: string }> = [
        ...[...riderIds].map((id) => ({ type: "rider" as const, id })),
        ...[...ctorIds].map((id) => ({ type: "constructor" as const, id })),
        ...[...teamIds].map((id) => ({ type: "team" as const, id })),
      ];

      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let skippedNoOpening = 0;
      for (const asset of assets) {
        const key = assetKey(asset.type, asset.id);
        const P0 = p0ByAsset.get(key);
        if (P0 === undefined) {
          skippedNoOpening += 1;
          continue;
        }
        const pmax = asset.type === "rider" ? PMAX_RIDER : PMAX_GROUP;
        const pointsMap =
          asset.type === "rider"
            ? pointsByGp
            : asset.type === "constructor"
              ? ctorPointsByGp
              : teamPointsByGp;
        const perfOf = (round: number): number => {
          const sGp = gpByRound.get(round);
          if (!sGp) return 0;
          const pts = pointsMap.get(sGp.id)?.get(asset.id) ?? 0;
          return perf(pts, pmax);
        };
        const newPrice = round2(
          computeNextPrice({
            prevPrice: prevByAsset.get(key) ?? P0,
            P0,
            perfCurrent: perfOf(gp.round),
            perfPrev1: perfOf(gp.round - 1),
            perfPrev2: perfOf(gp.round - 2),
          }),
        );
        const existing = nextByAsset.get(key);
        if (existing) {
          if (Number(existing.price) === newPrice) {
            unchanged += 1;
            continue;
          }
          // Corrección (resultados definitivos cambiados): update + auditoría.
          const row = await tx.price.update({
            where: { id: existing.id },
            data: {
              price: newPrice,
              reason: "formula",
              rulesVersion: PRICING_VERSION,
              createdBy: null,
            },
          });
          await appendAudit(tx, {
            actorId: null,
            action: "price.formula_recompute",
            entity: "price",
            entityId: row.id,
            beforeData: { price: Number(existing.price) },
            afterData: {
              assetType: asset.type,
              assetId: asset.id,
              gpId: next.id,
              price: newPrice,
            },
          });
          updated += 1;
        } else {
          await tx.price.create({
            data: {
              assetType: asset.type,
              assetId: asset.id,
              gpId: next.id,
              price: newPrice,
              reason: "formula",
              rulesVersion: PRICING_VERSION,
              createdBy: null,
            },
          });
          created += 1;
        }
      }
      return {
        targetGpId: next.id,
        targetGpRound: next.round,
        created,
        updated,
        unchanged,
        skippedNoOpening,
        skippedLocked: false,
      };
    };
    try {
      return await this.deps.prisma.$transaction(run);
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        return await this.deps.prisma.$transaction(run);
      }
      throw error;
    }
  }

  /**
   * Ajuste manual del precio de un activo para un GP concreto (US-08): el
   * admin fija o cambia el precio. `reason = manual`, `createdBy = actor`,
   * auditado (`price.manual_set`, before/after).
   *
   * - Activo y GP deben existir (NOT_FOUND).
   * - Gate de lockout evaluado **dentro de la transacción** (patrón de la
   *   invariantes, AGENTS.md §8): GP `locked` → rechazado sin tocar la BD
   *   (CA US-08).
   * - Upsert: no existe → crea (before=null); mismo valor → no-op sin
   *   auditar; otro valor → update (before/after).
   */
  async setManualPrice(
    input: SetManualPriceInput,
    meta: AuditMeta,
  ): Promise<SetManualPriceResult> {
    const asset = await this.findAsset(input.assetType, input.assetId);
    if (!asset) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: assetNotFoundMessage(input.assetType),
      });
    }
    const run = async (tx: Prisma.TransactionClient) => {
      const gp = await tx.gp.findUnique({ where: { id: input.gpId } });
      if (!gp) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "El GP no existe.",
        });
      }
      // Gate de lockout: los precios de un GP cerrado no cambian.
      if (gp.status === "locked") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No se pueden cambiar los precios de un GP en lockout.",
        });
      }
      const existing = await tx.price.findFirst({
        where: {
          assetType: input.assetType,
          assetId: input.assetId,
          gpId: input.gpId,
        },
      });
      const afterData = {
        assetType: input.assetType,
        assetId: input.assetId,
        gpId: input.gpId,
        price: input.price,
      };
      if (existing) {
        if (Number(existing.price) === input.price) {
          return { price: input.price, status: "unchanged" as const };
        }
        const row = await tx.price.update({
          where: { id: existing.id },
          data: {
            price: input.price,
            reason: "manual",
            rulesVersion: null,
            createdBy: meta.actorId,
          },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "price.manual_set",
          entity: "price",
          entityId: row.id,
          beforeData: { price: Number(existing.price) },
          afterData,
          ip: meta.ip,
        });
        return { price: input.price, status: "updated" as const };
      }
      const row = await tx.price.create({
        data: {
          assetType: input.assetType,
          assetId: input.assetId,
          gpId: input.gpId,
          price: input.price,
          reason: "manual",
          rulesVersion: null,
          createdBy: meta.actorId,
        },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "price.manual_set",
        entity: "price",
        entityId: row.id,
        beforeData: null,
        afterData,
        ip: meta.ip,
      });
      return { price: input.price, status: "created" as const };
    };
    try {
      return await this.deps.prisma.$transaction(run);
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        return await this.deps.prisma.$transaction(run);
      }
      throw error;
    }
  }

  // ── Interno ──

  /** El activo del tipo dado existe. */
  private async findAsset(
    assetType: AssetType,
    assetId: string,
  ): Promise<boolean> {
    switch (assetType) {
      case "rider":
        return Boolean(
          await this.deps.prisma.rider.findUnique({ where: { id: assetId } }),
        );
      case "constructor":
        return Boolean(
          await this.deps.prisma.constructor.findUnique({
            where: { id: assetId },
          }),
        );
      case "team":
        return Boolean(
          await this.deps.prisma.team.findUnique({ where: { id: assetId } }),
        );
    }
  }

  /**
   * Activos de un tipo ordenados por nombre (fila completa: el modelo
   * `Constructor` no admite `select` — colisión de nombre).
   */
  private async listAssets(
    assetType: AssetType,
  ): Promise<Array<{ id: string; name: string }>> {
    switch (assetType) {
      case "rider":
        return this.deps.prisma.rider.findMany({ orderBy: { name: "asc" } });
      case "constructor":
        return this.deps.prisma.constructor.findMany({
          orderBy: { name: "asc" },
        });
      case "team":
        return this.deps.prisma.team.findMany({ orderBy: { name: "asc" } });
    }
  }

  /**
   * El GP tiene al menos un resultado **definitivo** en su carrera
   * principal (condición para aplicar la fórmula, US-08).
   */
  private async gpHasDefinitiveRaceResults(
    tx: Prisma.TransactionClient,
    gpId: string,
  ): Promise<boolean> {
    const race = await tx.weekendEvent.findFirst({
      where: { gpId, type: "race" },
      orderBy: { orderNum: "asc" },
    });
    if (!race) return false;
    const count = await tx.result.count({
      where: { eventId: race.id, status: "definitive" },
    });
    return count > 0;
  }

  /**
   * Puntos de cada piloto en la carrera principal de un GP (solo
   * resultados definitivos): posición → puntos (scoring-v1) + bono
   * ganador. Sin resultado o sin posición (DNF/baja) → ausente del mapa
   * (perf 0 en la fórmula, que topa a [0,100]).
   */
  private async raceRiderPoints(
    tx: Prisma.TransactionClient,
    gpId: string,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const race = await tx.weekendEvent.findFirst({
      where: { gpId, type: "race" },
      orderBy: { orderNum: "asc" },
    });
    if (!race) return out;
    const results = await tx.result.findMany({
      where: { eventId: race.id, status: "definitive" },
    });
    for (const r of results) {
      if (r.position === null) continue;
      const pts =
        mainRacePositionPoints(r.position) +
        (r.position === 1 ? WINNER_BONUS : 0);
      out.set(r.riderId, pts);
    }
    return out;
  }
}
