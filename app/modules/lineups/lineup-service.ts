/**
 * Servicio de lineups (US-09, ADR-0017) — capa de I/O que orquesta el
 * núcleo puro (`./core`) con Prisma.
 *
 * `save` corre en UNA sola transacción:
 *
 * 1. Bloqueo de la fila del GP (`FOR UPDATE`): serializa los saves del
 *    mismo GP y evalúa el gate de lockout de forma atómica (ADR-0017 §5;
 *    CA US-13: tras el cierre no se aplica nada, ni parcialmente).
 * 2. Gate de lockout: `status = locked ∨ now ≥ lockoutAt` → rechazado
 *    (PRECONDITION_FAILED, el mismo gate que los precios de US-08).
 * 3. El coste se recalcula SIEMPRE en el servidor con los precios
 *    congelados del GP (ADR-0015): el cliente nunca envía coste ni
 *    presupuesto (invariante 2).
 * 4. Presupuesto: coste ≤ B + carry (derivado de `budget_movements`).
 * 5. Primer save: escribe `base + carry + spend(−coste)` (idempotente: la
 *    fila bloqueada + unique `(user, gp)` impiden duplicarlo). Saves
 *    posteriores: diferencia mínima (`diffSlots`: swap/add/remove = 1
 *    cambio; reasignar oro↔plata es gratis y se registra como
 *    `gold_silver` — US-11) + historial (`lineup_changes`) +
 *    `spend(−Δcoste)`.
 * 6. Reemplazo de slots (delete + createMany: el trigger de composición
 *    valida el estado final de cada sentencia — el borrador vacío es
 *    válido).
 *
 * Los saves no son acciones sensibles para `audit_log`: el historial
 * auditable es `lineup_changes` (quién/cuándo/qué/coste antes-después).
 */
import type { GpStatus, Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { appendAudit } from "@/modules/admin/audit";
import {
  seasonRulesSchema,
  type SeasonRules,
} from "@/shared/validation/season-rules";

import {
  balanceFromMovements,
  budgetBreakdown,
  changeSpendMovement,
  diffSlots,
  firstSaveBudget,
  firstSaveMovements,
  lineupCost,
  remainingChanges,
  round2,
  validateLineup,
  type BudgetMovement,
  type GpPrice,
  type LineupSlots,
  type SlotChange,
} from "./core";

// ── Inputs / outputs (contratos del servicio; el router pasa datos
//    parseados por Zod) ────────────────────────────────────────────────────────

export interface SaveLineupInput {
  gpId: string;
  slots: {
    gold: readonly string[];
    silver: readonly string[];
    constructorId: string;
    teamId: string;
  };
}

export interface SaveLineupResult {
  gpId: string;
  /** Coste recalculado en el servidor (precios congelados del GP). */
  cost: number;
  /** Presupuesto total del GP: B + carry. */
  budget: number;
  /** Saldo: presupuesto − coste. */
  balance: number;
  /** Cambios consumidos por este save (0 en el primer save). */
  changesApplied: number;
  /** Cambios restantes del GP (perGp + exenciones sin usar − usados). */
  remainingChanges: number;
  firstSave: boolean;
}

/** Lineup del usuario para un GP (null si aún no lo ha guardado). */
export interface LineupView {
  gpId: string;
  cost: number;
  budget: number;
  balance: number;
  slots: LineupSlots;
  usedChanges: number;
  remainingChanges: number;
  updatedAt: Date;
}

/**
 * Presupuesto del usuario para un GP (US-10): base + carry.
 * Si aún no ha guardado, es el que recibirá en el primer save — la misma
 * fórmula que `save` valida (B + min(t·sin_usar, cmax), opción E).
 */
export interface GpBudget {
  base: number;
  carry: number;
  total: number;
}

/** Contexto del builder para un GP: GP + presupuesto + mercado congelado. */
export interface BuilderView {
  gp: {
    id: string;
    name: string;
    round: number;
    status: GpStatus;
    lockoutAt: Date | null;
  };
  /** Presupuesto del usuario para este GP (US-10). */
  budget: GpBudget;
  riders: {
    riderId: string;
    name: string;
    teamId: string;
    teamName: string;
    constructorId: string;
    constructorName: string;
    /** Precio congelado para el GP (null = sin precio → no incluye). */
    price: number | null;
  }[];
  constructors: { id: string; name: string; price: number | null }[];
  teams: {
    id: string;
    name: string;
    constructorId: string;
    constructorName: string;
    price: number | null;
  }[];
}

/** Actor de la acción (el propio usuario). */
export interface UserMeta {
  userId: string;
}

/** Fila del GP bloqueada con FOR UPDATE (solo los campos que usa `save`). */
interface GpRow {
  id: string;
  season_id: string;
  round: number;
  status: GpStatus;
  lockout_at: Date | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Presupuesto = suma de movimientos `base` + `carry` (B + carry, ADR-0017). */
function totalBudget(movements: readonly BudgetMovement[]): number {
  return budgetBreakdown(movements).total;
}

/** Mensaje de rechazo cuando el coste supera el presupuesto (CA US-09). */
function overBudgetMessage(cost: number, budget: number): string {
  const excess = round2(cost - budget);
  return `El lineup excede el presupuesto por ${excess} (coste ${cost}, presupuesto ${budget}).`;
}

/** Slots a partir de filas de BD (el trigger garantiza la composición). */
function slotsFromRows(
  rows: readonly { slotType: string; assetId: string }[],
): LineupSlots {
  return {
    gold: rows.filter((r) => r.slotType === "gold").map((r) => r.assetId),
    silver: rows.filter((r) => r.slotType === "silver").map((r) => r.assetId),
    constructorId:
      rows.find((r) => r.slotType === "constructor")?.assetId ?? null,
    teamId: rows.find((r) => r.slotType === "team")?.assetId ?? null,
  };
}

/** Filas de `lineup_slots` a escribir para una composición. */
function slotsData(
  lineupId: string,
  slots: SaveLineupInput["slots"],
): Prisma.LineupSlotCreateManyInput[] {
  return [
    ...slots.gold.map((assetId): Prisma.LineupSlotCreateManyInput => ({
      lineupId,
      slotType: "gold",
      assetType: "rider",
      assetId,
    })),
    ...slots.silver.map((assetId): Prisma.LineupSlotCreateManyInput => ({
      lineupId,
      slotType: "silver",
      assetType: "rider",
      assetId,
    })),
    {
      lineupId,
      slotType: "constructor",
      assetType: "constructor",
      assetId: slots.constructorId,
    },
    {
      lineupId,
      slotType: "team",
      assetType: "team",
      assetId: slots.teamId,
    },
  ];
}

export interface LineupServiceDeps {
  prisma: PrismaClient;
}

export class LineupService {
  private readonly prisma: PrismaClient;

  constructor(deps: LineupServiceDeps) {
    this.prisma = deps.prisma;
  }

  /**
   * Componer y guardar el lineup para un GP (US-09). El primer save no
   * consume cambios; los posteriores consumen la diferencia mínima
   * (`diffSlots`) y pueden consumir exenciones al agotar los cambios del GP.
   */
  async save(
    input: SaveLineupInput,
    meta: UserMeta,
  ): Promise<SaveLineupResult> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Bloqueo de la fila del GP: serializa los saves y evalúa el gate
      //    de lockout de forma atómica (ADR-0017 §5).
      const rows = await tx.$queryRaw<GpRow[]>`
        SELECT id, season_id, round, status, lockout_at
        FROM gps
        WHERE id = ${input.gpId}::uuid
        FOR UPDATE
      `;
      const gp = rows[0];
      if (!gp) {
        throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
      }

      // 2. Gate de lockout (dentro de la transacción).
      const now = new Date();
      if (
        gp.status === "locked" ||
        (gp.lockout_at !== null && now >= gp.lockout_at)
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "El GP está cerrado (lockout): no se pueden guardar lineups.",
        });
      }

      // 3. Reglas de la temporada (versión vigente): B/t/cmax, límites,
      //    transfers.
      const rules = await this.latestRules(tx, gp.season_id);

      // 4. Afiliaciones del GP + precios congelados (ADR-0015).
      const [affiliations, prices] = await Promise.all([
        tx.riderAffiliation.findMany({ where: { gpId: gp.id } }),
        tx.price.findMany({ where: { gpId: gp.id } }),
      ]);
      const gpPrices: GpPrice[] = prices.map((p) => ({
        assetType: p.assetType,
        assetId: p.assetId,
        price: Number(p.price),
      }));

      // 5. Validación + coste (núcleo puro; el cliente nunca envía coste).
      const validation = validateLineup(input.slots, affiliations, rules.limits);
      if (!validation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.reasons.join("; "),
        });
      }
      const costResult = lineupCost(input.slots, gpPrices);
      if (!costResult.ok) {
        const missing = costResult.missing
          .map((m) => `${m.assetType} ${m.assetId}`)
          .join(", ");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Activos sin precio congelado para este GP: ${missing}.`,
        });
      }
      const cost = costResult.cost;

      // 6. Lineup del usuario para el GP (unique (user, gp)).
      const lineup = await tx.lineup.findUnique({
        where: { userId_gpId: { userId: meta.userId, gpId: gp.id } },
        include: { slots: true },
      });

      // 7. Capacidad de cambios (derivada del historial + exenciones,
      //    ADR-0017).
      const [usedChanges, exemptions] = await Promise.all([
        tx.lineupChange.count({
          where: {
            userId: meta.userId,
            gpId: gp.id,
            type: { in: ["add", "remove", "swap"] },
          },
        }),
        tx.changeExemption.findMany({
          where: { userId: meta.userId, gpId: gp.id, usedAt: null },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      const perGp = rules.transfers.perGp;
      const capacity = remainingChanges(
        usedChanges,
        exemptions.length,
        perGp,
      );

      // 8. Primer save: presupuesto = B + carry (desde el saldo del GP
      //    anterior); movimientos base + carry + spend(−coste); no consume
      //    cambios.
      if (lineup === null) {
        const prevBalance = await this.prevGpBalance(
          tx,
          gp.season_id,
          gp.round,
          meta.userId,
        );
        const movements = firstSaveMovements(rules.economy, prevBalance, cost);
        const budget = totalBudget(movements);
        if (cost > budget) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: overBudgetMessage(cost, budget),
          });
        }
        const created = await tx.lineup.create({
          data: { userId: meta.userId, gpId: gp.id },
        });
        await tx.budgetMovement.createMany({
          data: movements.map((m) => ({
            userId: meta.userId,
            gpId: gp.id,
            type: m.type,
            amount: m.amount,
            reference: created.id,
            rulesVersion: rules.rulesVersion,
          })),
        });
        await tx.lineupSlot.createMany({
          data: slotsData(created.id, input.slots),
        });
        return {
          gpId: gp.id,
          cost,
          budget,
          balance: round2(budget - cost),
          changesApplied: 0,
          remainingChanges: capacity,
          firstSave: true,
        };
      }

      // 9. Save posterior: presupuesto = base + carry ya registrados.
      const stored = await tx.budgetMovement.findMany({
        where: { userId: meta.userId, gpId: gp.id },
        select: { type: true, amount: true },
      });
      const budget = totalBudget(
        stored.map((m) => ({ type: m.type, amount: Number(m.amount) })),
      );
      if (cost > budget) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: overBudgetMessage(cost, budget),
        });
      }

      // 10. Diferencia mínima: cambios consumidos por este save. Las
      //     reasignaciones oro↔plata (`gold_silver`) se registran en el
      //     historial pero NO consumen cambio (US-11: gratis).
      const changes: SlotChange[] = diffSlots(
        slotsFromRows(lineup.slots),
        input.slots,
      );
      const counted = changes.filter((c) => c.type !== "gold_silver");
      if (counted.length > capacity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No te quedan cambios para este GP; usa tu wildcard.",
        });
      }
      // Las exenciones solo se consumen al agotar los cambios del GP
      // (ADR-0017): las entradas que exceden perGp llevan
      // `reason = "exencion:<id>"`.
      const perGpLeft = Math.max(0, perGp - usedChanges);
      const consumed = exemptions.slice(
        0,
        Math.max(0, counted.length - perGpLeft),
      );

      if (changes.length > 0) {
        // Coste antes del cambio: recalculado en el servidor (precios
        // congelados).
        const costBeforeResult = lineupCost(
          slotsFromRows(lineup.slots),
          gpPrices,
        );
        if (!costBeforeResult.ok) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "El lineup actual no tiene precios congelados para este GP; contacta con el administrador.",
          });
        }
        const costBefore = costBeforeResult.cost;
        const movement = changeSpendMovement(costBefore, cost);
        if (movement.amount !== 0) {
          await tx.budgetMovement.create({
            data: {
              userId: meta.userId,
              gpId: gp.id,
              type: movement.type,
              amount: movement.amount,
              reference: lineup.id,
              rulesVersion: rules.rulesVersion,
            },
          });
        }
        // La exención se asigna por índice dentro de los cambios contados
        // (las `gold_silver` son gratis: nunca llevan exención).
        let countedIndex = -1;
        await tx.lineupChange.createMany({
          data: changes.map((change) => {
            if (change.type !== "gold_silver") {
              countedIndex += 1;
            }
            const exemption =
              change.type === "gold_silver"
                ? undefined
                : countedIndex >= perGpLeft
                  ? consumed[countedIndex - perGpLeft]
                  : undefined;
            return {
              lineupId: lineup.id,
              gpId: gp.id,
              type: change.type,
              assetType: change.assetType,
              assetId: change.assetId,
              costBefore,
              costAfter: cost,
              reason: exemption ? `exencion:${exemption.id}` : null,
              userId: meta.userId,
            };
          }),
        });
        if (consumed.length > 0) {
          await tx.changeExemption.updateMany({
            where: { id: { in: consumed.map((c) => c.id) } },
            data: { usedAt: new Date() },
          });
        }
      }

      // 11. Reemplazo de slots (delete + createMany; el trigger valida el
      //     estado final de cada sentencia).
      await tx.lineupSlot.deleteMany({ where: { lineupId: lineup.id } });
      await tx.lineupSlot.createMany({
        data: slotsData(lineup.id, input.slots),
      });

      return {
        gpId: gp.id,
        cost,
        budget,
        balance: round2(budget - cost),
        changesApplied: counted.length,
        remainingChanges: capacity - counted.length,
        firstSave: false,
      };
    });
  }

  /** Lineup del usuario para un GP (null si aún no lo ha guardado). */
  async get(gpId: string, userId: string): Promise<LineupView | null> {
    const lineup = await this.prisma.lineup.findUnique({
      where: { userId_gpId: { userId, gpId } },
      include: { slots: true, gp: true },
    });
    if (!lineup) return null;

    const prices = await this.prisma.price.findMany({
      where: { gpId: lineup.gp.id },
    });
    const gpPrices: GpPrice[] = prices.map((p) => ({
      assetType: p.assetType,
      assetId: p.assetId,
      price: Number(p.price),
    }));
    const slots = slotsFromRows(lineup.slots);
    const costResult = lineupCost(slots, gpPrices);
    if (!costResult.ok) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "El lineup no tiene precios congelados para su GP; contacta con el administrador.",
      });
    }

    const movements = await this.prisma.budgetMovement.findMany({
      where: { userId, gpId: lineup.gp.id },
      select: { type: true, amount: true },
    });
    const asMovements: BudgetMovement[] = movements.map((m) => ({
      type: m.type,
      amount: Number(m.amount),
    }));

    const rules = await this.latestRules(this.prisma, lineup.gp.seasonId);
    const [usedChanges, unusedExemptions] = await Promise.all([
      this.prisma.lineupChange.count({
        where: {
          userId,
          gpId: lineup.gp.id,
          type: { in: ["add", "remove", "swap"] },
        },
      }),
      this.prisma.changeExemption.count({
        where: { userId, gpId: lineup.gp.id, usedAt: null },
      }),
    ]);

    return {
      gpId: lineup.gp.id,
      cost: costResult.cost,
      budget: totalBudget(asMovements),
      balance: balanceFromMovements(asMovements),
      slots,
      usedChanges,
      remainingChanges: remainingChanges(
        usedChanges,
        unusedExemptions,
        rules.transfers.perGp,
      ),
      updatedAt: lineup.updatedAt,
    };
  }

  /**
   * Contexto del builder para un GP: GP + presupuesto del usuario (US-10)
   * + mercado con precios congelados.
   */
  async builder(gpId: string, userId: string): Promise<BuilderView> {
    const gp = await this.prisma.gp.findUnique({ where: { id: gpId } });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    const [affiliations, prices, constructors, teams, budget] =
      await Promise.all([
        this.prisma.riderAffiliation.findMany({
          where: { gpId },
          include: { rider: true, team: true, constructor: true },
        }),
        this.prisma.price.findMany({ where: { gpId } }),
        this.prisma.constructor.findMany({ orderBy: { name: "asc" } }),
        this.prisma.team.findMany({
          orderBy: { name: "asc" },
          include: { constructor: true },
        }),
        this.builderBudget(gp, userId),
      ]);
    const priceOf = (assetType: string, assetId: string): number | null => {
      const price = prices.find(
        (p) => p.assetType === assetType && p.assetId === assetId,
      );
      return price ? Number(price.price) : null;
    };
    return {
      gp: {
        id: gp.id,
        name: gp.name,
        round: gp.round,
        status: gp.status,
        lockoutAt: gp.lockoutAt,
      },
      budget,
      riders: affiliations.map((a) => ({
        riderId: a.riderId,
        name: a.rider.name,
        teamId: a.teamId,
        teamName: a.team.name,
        constructorId: a.constructorId,
        constructorName: a.constructor.name,
        price: priceOf("rider", a.riderId),
      })),
      constructors: constructors.map((c) => ({
        id: c.id,
        name: c.name,
        price: priceOf("constructor", c.id),
      })),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        constructorId: t.constructorId,
        constructorName: t.constructor.name,
        price: priceOf("team", t.id),
      })),
    };
  }

  /**
   * Confirmación de lesión por GP (US-12, ADR-0017): el admin confirma que
   * un piloto no estará en el GP → +1 cambio gratuito a cada usuario que lo
   * tenga en su lineup de ese GP. Idempotente (unique `(gp, asset)`).
   */
  async confirmInjury(
    input: { gpId: string; assetId: string; reason?: string },
    meta: { actorId: string; ip?: string | null },
  ): Promise<{ confirmationId: string; exemptionsGranted: number }> {
    const gp = await this.prisma.gp.findUnique({ where: { id: input.gpId } });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    const rider = await this.prisma.rider.findUnique({
      where: { id: input.assetId },
    });
    if (!rider) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El piloto no existe." });
    }

    return this.prisma.$transaction(async (tx) => {
      // Idempotencia: si ya está confirmada, no se re-concede.
      const existing = await tx.injuryConfirmation.findUnique({
        where: {
          gpId_assetType_assetId: {
            gpId: input.gpId,
            assetType: "rider",
            assetId: input.assetId,
          },
        },
      });
      if (existing) {
        return { confirmationId: existing.id, exemptionsGranted: 0 };
      }

      const confirmation = await tx.injuryConfirmation.create({
        data: {
          gpId: input.gpId,
          assetType: "rider",
          assetId: input.assetId,
          reason: input.reason ?? null,
          confirmedBy: meta.actorId,
        },
      });

      // Concede +1 cambio a cada usuario que tenga al piloto en su lineup
      // actual de ese GP (ADR-0017: "según el lineup en el momento de la
      // confirmación").
      const lineups = await tx.lineup.findMany({
        where: { gpId: input.gpId },
        include: { slots: true },
      });
      const affectedUserIds = lineups
        .filter((l) =>
          l.slots.some((s) => s.assetType === "rider" && s.assetId === input.assetId),
        )
        .map((l) => l.userId);

      if (affectedUserIds.length > 0) {
        await tx.changeExemption.createMany({
          data: affectedUserIds.map((userId) => ({
            userId,
            gpId: input.gpId,
            injuryConfirmationId: confirmation.id,
          })),
        });
      }

      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "injury.confirmed",
        entity: "injury",
        entityId: confirmation.id,
        afterData: {
          gpId: input.gpId,
          assetId: input.assetId,
          exemptionsGranted: affectedUserIds.length,
        },
        ip: meta.ip,
      });

      return {
        confirmationId: confirmation.id,
        exemptionsGranted: affectedUserIds.length,
      };
    });
  }

  /**
   * Wildcard (US-12, ADR-0017): resetea el lineup completo sin consumir
   * cambios por GP. 1 por temporada (`season_rules.transfers.wildcardsPerSeason`).
   * Registra una entrada `lineup_changes` de tipo `wildcard` (sin activo).
   */
  async applyWildcard(
    input: SaveLineupInput,
    meta: { userId: string },
  ): Promise<{ cost: number; budget: number; balance: number; wildcardUsed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Bloqueo del GP + gate de lockout (mismo que `save`).
      const rows = await tx.$queryRaw<Array<{ id: string; season_id: string; round: number; status: GpStatus; lockout_at: Date | null }>>`
        SELECT id, season_id, round, status, lockout_at
        FROM gps
        WHERE id = ${input.gpId}::uuid
        FOR UPDATE
      `;
      const gp = rows[0];
      if (!gp) {
        throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
      }
      const now = new Date();
      if (gp.status === "locked" || (gp.lockout_at !== null && now >= gp.lockout_at)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El GP está cerrado (lockout): no se pueden guardar lineups.",
        });
      }

      // 2. Reglas de la temporada.
      const rules = await this.latestRules(tx, gp.season_id);

      // 3. Wildcard disponible? (1 por temporada).
      const wildcardCount = await tx.lineupChange.count({
        where: {
          userId: meta.userId,
          gp: { seasonId: gp.season_id },
          type: "wildcard",
        },
      });
      if (wildcardCount >= rules.transfers.wildcardsPerSeason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ya usaste tu wildcard esta temporada.",
        });
      }

      // 4. Afiliaciones + precios congelados.
      const [affiliations, prices] = await Promise.all([
        tx.riderAffiliation.findMany({ where: { gpId: gp.id } }),
        tx.price.findMany({ where: { gpId: gp.id } }),
      ]);
      const gpPrices: GpPrice[] = prices.map((p) => ({
        assetType: p.assetType,
        assetId: p.assetId,
        price: Number(p.price),
      }));

      // 5. Validación + coste.
      const validation = validateLineup(input.slots, affiliations, rules.limits);
      if (!validation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.reasons.join("; "),
        });
      }
      const costResult = lineupCost(input.slots, gpPrices);
      if (!costResult.ok) {
        const missing = costResult.missing
          .map((m) => `${m.assetType} ${m.assetId}`)
          .join(", ");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Activos sin precio congelado para este GP: ${missing}.`,
        });
      }
      const cost = costResult.cost;

      // 6. Lineup del usuario (si no existe, se crea — primer save).
      const lineup = await tx.lineup.findUnique({
        where: { userId_gpId: { userId: meta.userId, gpId: gp.id } },
        include: { slots: true },
      });

      let costBefore: number;
      let budget: number;

      if (lineup === null) {
        // Primer save: presupuesto = B + carry.
        const prevBalance = await this.prevGpBalance(tx, gp.season_id, gp.round, meta.userId);
        const movements = firstSaveMovements(rules.economy, prevBalance, cost);
        budget = totalBudget(movements);
        if (cost > budget) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: overBudgetMessage(cost, budget),
          });
        }
        costBefore = 0;
        const created = await tx.lineup.create({
          data: { userId: meta.userId, gpId: gp.id },
        });
        await tx.budgetMovement.createMany({
          data: movements.map((m) => ({
            userId: meta.userId,
            gpId: gp.id,
            type: m.type,
            amount: m.amount,
            reference: created.id,
            rulesVersion: rules.rulesVersion,
          })),
        });
        await tx.lineupSlot.createMany({
          data: slotsData(created.id, input.slots),
        });
        // Entrada wildcard (costBefore = 0, costAfter = coste).
        await tx.lineupChange.create({
          data: {
            lineupId: created.id,
            gpId: gp.id,
            type: "wildcard",
            assetType: null,
            assetId: null,
            costBefore: 0,
            costAfter: cost,
            reason: null,
            userId: meta.userId,
          },
        });
      } else {
        // Lineup existente: reset completo.
        const stored = await tx.budgetMovement.findMany({
          where: { userId: meta.userId, gpId: gp.id },
          select: { type: true, amount: true },
        });
        budget = totalBudget(
          stored.map((m) => ({ type: m.type, amount: Number(m.amount) })),
        );
        if (cost > budget) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: overBudgetMessage(cost, budget),
          });
        }
        const costBeforeResult = lineupCost(slotsFromRows(lineup.slots), gpPrices);
        if (!costBeforeResult.ok) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "El lineup actual no tiene precios congelados para este GP; contacta con el administrador.",
          });
        }
        costBefore = costBeforeResult.cost;
        const movement = changeSpendMovement(costBefore, cost);
        if (movement.amount !== 0) {
          await tx.budgetMovement.create({
            data: {
              userId: meta.userId,
              gpId: gp.id,
              type: movement.type,
              amount: movement.amount,
              reference: lineup.id,
              rulesVersion: rules.rulesVersion,
            },
          });
        }
        // Reemplazo de slots.
        await tx.lineupSlot.deleteMany({ where: { lineupId: lineup.id } });
        await tx.lineupSlot.createMany({
          data: slotsData(lineup.id, input.slots),
        });
        // Entrada wildcard (costBefore, costAfter).
        await tx.lineupChange.create({
          data: {
            lineupId: lineup.id,
            gpId: gp.id,
            type: "wildcard",
            assetType: null,
            assetId: null,
            costBefore,
            costAfter: cost,
            reason: null,
            userId: meta.userId,
          },
        });
      }

      return {
        cost,
        budget,
        balance: round2(budget - cost),
        wildcardUsed: true,
      };
    });
  }

  /**
   * Historial de cambios del usuario para un GP (US-12): quién/cuándo/qué/
   * coste antes-después. Ordenado por fecha (más reciente primero).
   */
  async history(
    gpId: string,
    userId: string,
  ): Promise<
    Array<{
      id: string;
      type: string;
      assetType: string | null;
      assetId: string | null;
      costBefore: number | null;
      costAfter: number | null;
      reason: string | null;
      createdAt: Date;
    }>
  > {
    const gp = await this.prisma.gp.findUnique({ where: { id: gpId } });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    const changes = await this.prisma.lineupChange.findMany({
      where: { userId, gpId },
      orderBy: { createdAt: "desc" },
    });
    return changes.map((c) => ({
      id: c.id,
      type: c.type,
      assetType: c.assetType,
      assetId: c.assetId,
      costBefore: c.costBefore !== null ? Number(c.costBefore) : null,
      costAfter: c.costAfter !== null ? Number(c.costAfter) : null,
      reason: c.reason,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Presupuesto del usuario para el GP (US-10): si ya guardó, el registrado
   * en `budget_movements` (base + carry); si no, el que recibirá en el
   * primer save — la misma fórmula que `save` valida (opción E, ADR-0017).
   */
  private async builderBudget(
    gp: { id: string; seasonId: string; round: number },
    userId: string,
  ): Promise<GpBudget> {
    const movements = await this.prisma.budgetMovement.findMany({
      where: { userId, gpId: gp.id },
      select: { type: true, amount: true },
    });
    if (movements.length > 0) {
      return budgetBreakdown(
        movements.map((m) => ({ type: m.type, amount: Number(m.amount) })),
      );
    }
    const rules = await this.latestRules(this.prisma, gp.seasonId);
    const prevBalance = await this.prevGpBalance(
      this.prisma,
      gp.seasonId,
      gp.round,
      userId,
    );
    const total = firstSaveBudget(rules.economy, prevBalance);
    return {
      base: round2(rules.economy.B),
      carry: round2(total - rules.economy.B),
      total,
    };
  }

  /** Versión vigente de las reglas de la temporada (la más reciente). */
  private async latestRules(
    tx: Prisma.TransactionClient,
    seasonId: string,
  ): Promise<SeasonRules> {
    const rule = await tx.seasonRule.findFirst({
      where: { seasonId },
      orderBy: { createdAt: "desc" },
    });
    if (!rule) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "La temporada no tiene reglas publicadas.",
      });
    }
    return seasonRulesSchema.parse(rule.rules);
  }

  /**
   * Saldo del GP más reciente con `round < round` actual (0 si no hay):
   * el `sin_usar_{n-1}` para el carry (ADR-0017).
   */
  private async prevGpBalance(
    tx: Prisma.TransactionClient,
    seasonId: string,
    round: number,
    userId: string,
  ): Promise<number> {
    const prev = await tx.gp.findFirst({
      where: { seasonId, round: { lt: round } },
      orderBy: { round: "desc" },
      select: { id: true },
    });
    if (!prev) return 0;
    const movements = await tx.budgetMovement.findMany({
      where: { userId, gpId: prev.id },
      select: { type: true, amount: true },
    });
    return balanceFromMovements(
      movements.map((m) => ({ type: m.type, amount: Number(m.amount) })),
    );
  }
}
