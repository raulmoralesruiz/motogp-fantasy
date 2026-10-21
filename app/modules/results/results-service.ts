/**
 * Servicio de resultados (US-16, ADR-0018): importación manual de resultados
 * de un evento (q2/sprint/race).
 *
 * Una transacción por importación:
 *
 * 1. Bloqueo `FOR UPDATE` de la fila del GP (serializa las importaciones del
 *    mismo GP; mismo patrón que lineups, ADR-0017, y precios, ADR-0015).
 * 2. Gates: el GP existe y no está `cancelled`; el evento existe en ese GP,
 *    no está `cancelled` y es un evento de resultados (Q1 se rechaza); los
 *    pilotos existen en el mercado (no se exige afiliación).
 * 3. Validación semántica por entrada (núcleo puro), con rechazo atómico.
 * 4. Diferencia mínima contra las filas existentes (núcleo puro):
 *    crear / corregir / no-op.
 * 5. `reason` obligatorio si la importación corrige resultados existentes.
 * 6. Escrituras: filas (`status = provisional`, `results_version = null`),
 *    `results_history` (anterior→nuevo, motivo, actor, versión en vigor),
 *    `results_events` (`status = finished`) y `weekend_events`
 *    (`scheduled → finished`).
 * 7. Auditoría en la misma transacción (T-09): `results.import` (creación)
 *    o `results.correct` (corrección); el no-op no deja rastro (invariante 6).
 *
 * El estado de puntuación (FINISHED/DNF/ABSENT) NO se guarda: se deriva de
 * `started`/`finished` (en `raw`) por el motor de puntuación (US-19).
 */

import type {
  GpStatus as GpDbStatus,
  PrismaClient,
  Result as DbResult,
  ResultStatus,
  ResultsEventStatus,
  WeekendEventStatus,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { appendAudit } from "@/modules/admin/audit";
import type {
  GpStatus,
  ResultBonusCode,
  ResultEventKind,
  ResultPenaltyCode,
} from "@/shared/types";
import type {
  EventResultsInput,
  GpEventsInput,
  ImportEventInput,
  ResultEntryInput,
} from "@/shared/validation/results";

import {
  deriveStatus,
  diffResults,
  validateEntryForEvent,
  type ResultEntry,
  type ResultValues,
} from "./core";

export interface ResultsServiceDeps {
  prisma: PrismaClient;
}

/** Actor de la acción (admin) e IP del cliente (auditoría). */
export interface ResultsMeta {
  actorId: string;
  ip?: string | null;
}

/** Resumen de la importación (ADR-0018). */
export interface ImportEventResult {
  created: number;
  corrected: number;
  unchanged: number;
  kept: number;
}

/** Evento de resultados de un GP con su estado (UI de admin). */
export interface GpEventView {
  id: string;
  type: ResultEventKind;
  orderNum: number;
  /** Estado del evento del fin de semana (scheduled/finished/cancelled). */
  status: WeekendEventStatus;
  /** Estado de `results_events` (`null` si aún no hay resultados). */
  resultsStatus: ResultsEventStatus | null;
}

/** Fila actual de un evento (pre-carga de la UI de admin). */
export interface EventResultView {
  riderId: string;
  riderName: string;
  position: number | null;
  started: boolean;
  finished: boolean;
  penalties: ResultPenaltyCode[];
  bonuses: ResultBonusCode[];
  rawPoints: number | null;
  /** Estado de puntuación derivado de `started`/`finished` (ADR-0018). */
  derivedStatus: GpStatus;
  /** Ciclo de vida de la fila (provisional/definitive/corrected). */
  status: ResultStatus;
  resultsVersion: string | null;
}

/**
 * JSON plano de los valores (columna `raw` y auditoría).
 *
 * `type` (no `interface`): Prisma exige un index signature en
 * `InputJsonObject`, que TypeScript infiere en alias de objetos pero no en
 * interfaces.
 */
type ResultValuesJson = {
  position: number | null;
  started: boolean;
  finished: boolean;
  penalties: string[];
  bonuses: string[];
  rawPoints: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normaliza la entrada de Zod (`undefined` → `null`) a la entrada del núcleo. */
function normalizeEntry(entry: ResultEntryInput): ResultEntry {
  return {
    riderId: entry.riderId,
    position: entry.position ?? null,
    started: entry.started,
    finished: entry.finished,
    penalties: entry.penalties,
    bonuses: entry.bonuses,
    rawPoints: entry.rawPoints ?? null,
  };
}

/** Valores en JSON plano (columna `raw`: sin `riderId`, que es columna). */
function valuesToJson(values: ResultValues): ResultValuesJson {
  return {
    position: values.position,
    started: values.started,
    finished: values.finished,
    penalties: [...values.penalties],
    bonuses: [...values.bonuses],
    rawPoints: values.rawPoints,
  };
}

/** Entrada completa en JSON plano (auditoría: con `riderId`). */
function entryToJson(entry: ResultEntry): ResultValuesJson & { riderId: string } {
  return { riderId: entry.riderId, ...valuesToJson(entry) };
}

/**
 * Reconstruye la entrada del núcleo a partir de una fila existente.
 *
 * Los valores viven en `raw` (Json); el fallback a las columnas
 * desnormalizadas es defensivo (las filas escritas por este servicio siempre
 * llevan `raw`).
 */
function entryFromRow(row: DbResult): ResultEntry {
  const raw = (row.raw ?? null) as
    | {
        position?: number | null;
        started?: boolean;
        finished?: boolean;
        penalties?: readonly string[];
        bonuses?: readonly string[];
        rawPoints?: number | null;
      }
    | null;
  return {
    riderId: row.riderId,
    position: raw?.position ?? row.position,
    started: raw?.started ?? true,
    finished: raw?.finished ?? row.position !== null,
    penalties: (raw?.penalties ?? []) as readonly ResultPenaltyCode[],
    bonuses: (raw?.bonuses ?? []) as readonly ResultBonusCode[],
    rawPoints: raw?.rawPoints ?? (row.rawPoints === null ? null : Number(row.rawPoints)),
  };
}

// ── Servicio ──────────────────────────────────────────────────────────────────

export class ResultsService {
  private readonly prisma: PrismaClient;

  constructor(deps: ResultsServiceDeps) {
    this.prisma = deps.prisma;
  }

  /**
   * Importación manual de resultados de un evento (US-16, ADR-0018).
   *
   * Re-importar con los mismos valores es un no-op (sin escrituras, sin
   * histórico, sin auditoría — invariante 6). Con valores distintos es una
   * corrección: actualización de la fila + `results_history` (anterior→nuevo,
   * motivo, actor, versión en vigor); `definitive → corrected`,
   * `provisional` se mantiene. Las filas no presentes en el payload se
   * conservan (los resultados no se borran, se corrigen).
   */
  async importEvent(
    input: ImportEventInput,
    meta: ResultsMeta,
  ): Promise<ImportEventResult> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Bloqueo de la fila del GP (ADR-0018).
      const rows = await tx.$queryRaw<Array<{ id: string; status: GpDbStatus }>>`
        SELECT id, status
        FROM gps
        WHERE id = ${input.gpId}::uuid
        FOR UPDATE
      `;
      const gp = rows[0];
      if (!gp) {
        throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
      }
      if (gp.status === "cancelled") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El GP está cancelado: no se pueden importar resultados.",
        });
      }

      // 2. El evento existe en el GP, no está cancelado y es un evento de
      //    resultados (Q1 se rechaza).
      const event = await tx.weekendEvent.findFirst({
        where: { id: input.eventId, gpId: input.gpId },
      });
      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "El evento no existe en este GP.",
        });
      }
      if (event.type === "q1") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Q1 no es un evento de resultados.",
        });
      }
      if (event.status === "cancelled") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El evento está cancelado: no se pueden importar resultados.",
        });
      }
      const kind: ResultEventKind = event.type;

      // 3. Los pilotos existen en el mercado (no se exige afiliación).
      const riderIds = [...new Set(input.entries.map((e) => e.riderId))];
      const riders = await tx.rider.findMany({
        where: { id: { in: riderIds } },
        select: { id: true, name: true },
      });
      const riderNames = new Map(riders.map((r) => [r.id, r.name]));
      const missing = riderIds.filter((id) => !riderNames.has(id));
      if (missing.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Hay pilotos que no existen en el mercado: ${missing.join(", ")}.`,
        });
      }

      // 4. Validación semántica por entrada (núcleo puro); rechazo atómico.
      const entries = input.entries.map(normalizeEntry);
      const errors: string[] = [];
      for (const entry of entries) {
        for (const error of validateEntryForEvent(entry, kind)) {
          errors.push(`${riderNames.get(entry.riderId)}: ${error}`);
        }
      }
      if (errors.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errors.join(" "),
        });
      }

      // 5. Diferencia mínima contra las filas existentes (núcleo puro).
      const existingRows = await tx.result.findMany({
        where: { gpId: input.gpId, eventId: input.eventId },
      });
      const diff = diffResults(existingRows.map(entryFromRow), entries);

      // 6. `reason` obligatorio si la importación corrige resultados.
      if (diff.changed.length > 0 && !input.reason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "El motivo es obligatorio cuando la importación corrige resultados existentes.",
        });
      }

      // 7. No-op: sin cambios → sin escrituras, sin histórico, sin auditoría.
      if (diff.created.length === 0 && diff.changed.length === 0) {
        return {
          created: 0,
          corrected: 0,
          unchanged: diff.unchanged.length,
          kept: diff.kept.length,
        };
      }

      // 8. Creación de filas (provisional, `results_version = null`).
      for (const entry of diff.created) {
        await tx.result.create({
          data: {
            gpId: input.gpId,
            eventId: input.eventId,
            riderId: entry.riderId,
            position: entry.position,
            rawPoints: entry.rawPoints,
            status: "provisional",
            resultsVersion: null,
            source: "manual",
            sourceName: "manual",
            raw: valuesToJson(entry),
          },
        });
      }

      // 9. Correcciones: actualización + `results_history` (anterior→nuevo,
      //    motivo, actor, versión en vigor). `definitive → corrected`.
      for (const change of diff.changed) {
        const row = existingRows.find((r) => r.riderId === change.riderId);
        if (!row) {
          continue; // Inalcanzable: `changed` proviene del diff contra estas filas.
        }
        await tx.result.update({
          where: { id: row.id },
          data: {
            position: change.after.position,
            rawPoints: change.after.rawPoints,
            status: row.status === "definitive" ? "corrected" : row.status,
            source: "manual",
            sourceName: "manual",
            raw: valuesToJson(change.after),
          },
        });
        await tx.resultsHistory.create({
          data: {
            resultId: row.id,
            beforeData: valuesToJson(change.before),
            afterData: valuesToJson(change.after),
            reason: input.reason ?? "",
            resultsVersion: row.resultsVersion,
            userId: meta.actorId,
          },
        });
      }

      // 10. Efectos: `results_events` (`status = finished`) y
      //     `weekend_events` (`scheduled → finished`).
      await tx.resultsEvent.upsert({
        where: { gpId_eventId: { gpId: input.gpId, eventId: input.eventId } },
        update: { status: "finished" },
        create: {
          gpId: input.gpId,
          eventId: input.eventId,
          status: "finished",
        },
      });
      await tx.weekendEvent.updateMany({
        where: { id: input.eventId, status: "scheduled" },
        data: { status: "finished" },
      });

      // 11. Auditoría en la misma transacción (T-09): una entrada por acción.
      if (diff.changed.length > 0) {
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "results.correct",
          entity: "results",
          entityId: input.eventId,
          beforeData: {
            gpId: input.gpId,
            eventId: input.eventId,
            corrections: diff.changed.map((c) => ({
              riderId: c.riderId,
              before: valuesToJson(c.before),
            })),
          },
          afterData: {
            gpId: input.gpId,
            eventId: input.eventId,
            corrections: diff.changed.map((c) => ({
              riderId: c.riderId,
              after: valuesToJson(c.after),
            })),
            entries: entries.map(entryToJson),
            reason: input.reason ?? null,
          },
          ip: meta.ip,
        });
      } else {
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "results.import",
          entity: "results",
          entityId: input.eventId,
          afterData: {
            gpId: input.gpId,
            eventId: input.eventId,
            entries: entries.map(entryToJson),
            reason: input.reason ?? "importación manual",
          },
          ip: meta.ip,
        });
      }

      return {
        created: diff.created.length,
        corrected: diff.changed.length,
        unchanged: diff.unchanged.length,
        kept: diff.kept.length,
      };
    });
  }

  /**
   * Eventos de resultados de un GP con su estado (UI de admin, US-16).
   * Solo `q2`/`sprint`/`race`: Q1 no es un evento de resultados (ADR-0018).
   */
  async gpEvents(input: GpEventsInput): Promise<GpEventView[]> {
    const gp = await this.prisma.gp.findUnique({
      where: { id: input.gpId },
      select: { id: true },
    });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    const [events, resultsEvents] = await Promise.all([
      this.prisma.weekendEvent.findMany({
        where: { gpId: input.gpId, type: { in: ["q2", "sprint", "race"] } },
        orderBy: { orderNum: "asc" },
      }),
      this.prisma.resultsEvent.findMany({ where: { gpId: input.gpId } }),
    ]);
    const resultsByEvent = new Map(resultsEvents.map((r) => [r.eventId, r.status]));
    return events.map((e) => ({
      id: e.id,
      type: e.type as ResultEventKind,
      orderNum: e.orderNum,
      status: e.status,
      resultsStatus: resultsByEvent.get(e.id) ?? null,
    }));
  }

  /**
   * Filas actuales de un evento (pre-carga de la UI de admin, US-16):
   * valores + nombre del piloto + estado de la fila.
   */
  async eventResults(input: EventResultsInput): Promise<EventResultView[]> {
    const rows = await this.prisma.result.findMany({
      where: { gpId: input.gpId, eventId: input.eventId },
      include: { rider: { select: { name: true } } },
      orderBy: [
        { position: { sort: "asc", nulls: "last" } },
        { rider: { name: "asc" } },
      ],
    });
    return rows.map((row) => {
      const entry = entryFromRow(row);
      return {
        riderId: row.riderId,
        riderName: row.rider.name,
        position: entry.position,
        started: entry.started,
        finished: entry.finished,
        penalties: [...entry.penalties],
        bonuses: [...entry.bonuses],
        rawPoints: entry.rawPoints,
        derivedStatus: deriveStatus(entry),
        status: row.status,
        resultsVersion: row.resultsVersion,
      };
    });
  }
}
