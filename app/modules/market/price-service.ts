/**
 * Servicio de precios (US-07, ADR-0014): precios de apertura (P0) e
 * histórico.
 *
 * - `setOpeningPrice`: upsert auditado (ADR-0014) — si no existe, crea
 *   (auditoría `price.opening_set` con before=null); si existe con el mismo
 *   valor, no-op sin auditar; si existe con otro valor, lo actualiza
 *   (before/after). P0 se puede fijar o cambiar en cualquier momento
 *   (auditado); el gate de lockout para precios por GP es US-08.
 * - `listAssetPrices`: activos + P0 actual (o null) para el panel admin.
 * - `getPriceHistory`: P0 + una fila por GP, orden P0 → ronda (lectura
 *   pública).
 *
 * Fila de P0: `gpId = null`, `reason = manual`, `createdBy = actor`,
 * `rulesVersion = null` (no la produce una fórmula; US-08 usará
 * `pricing-v1` en sus filas).
 */
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@prisma/client";

import { appendAudit } from "@/modules/admin";
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
}
