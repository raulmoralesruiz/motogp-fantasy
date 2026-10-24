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
 *
 * US-17 (ADR-0019): auto-import desde la fuente (`source: "auto"`).
 * `importEventFromSource` comparte el núcleo transaccional con la importación
 * manual (mismo `FOR UPDATE`, gates, diff y efectos). Manual gana a auto: el
 * auto solo crea filas inexistentes y actualiza las `source: "auto"`, nunca
 * toca las `source: "manual"` (se conservan y se reportan como `kept`). Los
 * pilotos sin mapear se saltan y se reportan (`unmapped` →
 * `source_state.lastUnmapped`). `linkSource`/`unlinkSource` gestionan el
 * vínculo GP ↔ evento de la fuente (`Gp.sourceRef`); `setRiderMapping`/
 * `deleteRiderMapping` gestionan `rider_mappings`.
 */

import {
  Prisma,
  type GpStatus as GpDbStatus,
  type PrismaClient,
  type Result as DbResult,
  type ResultStatus,
  type ResultsEventStatus,
  type WeekendEventStatus,
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
  DeleteRiderMappingInput,
  EventResultsInput,
  GpEventsInput,
  ImportEventInput,
  LinkSourceInput,
  ResultEntryInput,
  SetRiderMappingInput,
  SourceEventsInput,
  SourceStateInput,
  UnlinkSourceInput,
} from "@/shared/validation/results";

import {
  deriveStatus,
  diffResults,
  resultEventLabel,
  validateEntryForEvent,
  type ResultEntry,
  type ResultValues,
} from "./core";
import type { ResultsSource } from "./pulselive-source";

export interface ResultsServiceDeps {
  prisma: PrismaClient;
  /** Fuente de resultados para el auto-import (US-17, ADR-0019). */
  source?: ResultsSource;
  /** Catálogo de eventos de la fuente (US-17, ADR-0019). */
  eventCatalog?: SourceEventCatalog;
}

/**
 * Catálogo de eventos de la fuente por temporada (US-17, ADR-0019): lo usa
 * `linkSource` para emparejar el nombre del GP con los eventos de la fuente.
 * Es una extensión del contrato `ResultsSource` (no forma parte de él);
 * `PulseLiveResultsSource` lo satisface estructuralmente.
 */
export interface SourceEventCatalog {
  listSeasonEvents(
    seasonYear: number,
  ): Promise<Array<{ eventRef: string; name: string }>>;
}

/**
 * Actor de la acción (admin) e IP del cliente (auditoría).
 * `actorId = null` = sistema (auto-import, ADR-0019).
 */
export interface ResultsMeta {
  actorId: string | null;
  ip?: string | null;
}

/** Resumen de la importación (ADR-0018). */
export interface ImportEventResult {
  created: number;
  corrected: number;
  unchanged: number;
  kept: number;
}

/**
 * Piloto sin mapeo en `rider_mappings` (reporte del auto-import, ADR-0019).
 *
 * `type` (no `interface`): Prisma exige un index signature en
 * `InputJsonObject` para la columna `lastUnmapped` (mismo motivo que
 * `ResultValuesJson`).
 */
export type UnmappedRider = {
  riderRef: string;
  name: string | null;
};

/** Resumen del auto-import desde la fuente (US-17, ADR-0019). */
export interface ImportEventFromSourceResult {
  created: number;
  corrected: number;
  unchanged: number;
  /** Filas conservadas sin tocar (manuales distintas del auto + ajenas al payload). */
  kept: number;
  /** Pilotos sin mapeo (se saltan y se reportan). */
  unmapped: UnmappedRider[];
}

/** Estado operativo del auto-import por (GP, evento, fuente) (UI de admin). */
export interface SourceStateView {
  event: ResultEventKind;
  source: string;
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastUnmapped: UnmappedRider[] | null;
}

/** Mapeo de piloto de la fuente con el piloto del mercado (UI de admin). */
export interface RiderMappingView {
  source: string;
  riderRef: string;
  riderId: string;
  riderName: string;
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
 * Aviso «Resultados actualizados» (US-15, dashboard): un GP donde el
 * usuario tiene lineup guardado y hay correcciones registradas en
 * `results_history` (US-16/US-17; el recálculo de US-19 también las
 * escribe). Orden: última corrección primero.
 */
export interface RecalculationNotice {
  gpId: string;
  gpName: string;
  round: number;
  seasonName: string;
  /** Nº de correcciones registradas en ese GP. */
  corrections: number;
  /** Fecha de la última corrección. */
  lastAt: Date;
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

/** Motivo estándar del auto-import (correcciones y auditoría, ADR-0019). */
const AUTO_IMPORT_REASON = "Importación automática desde la fuente (ADR-0019).";

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
 * Nombre del piloto desde el payload crudo de la fuente (defensivo):
 * `raw.rider.full_name` (PulseLive). `null` si no se puede extraer.
 */
function riderNameFromRaw(raw: Record<string, unknown>): string | null {
  const rider = raw.rider;
  if (typeof rider === "object" && rider !== null) {
    const fullName = (rider as { full_name?: unknown }).full_name;
    if (typeof fullName === "string" && fullName.length > 0) {
      return fullName;
    }
  }
  return null;
}

/**
 * Parsea `source_state.lastUnmapped` (defensivo: la columna es `Json`).
 * `null` si no hay datos o no son una lista de `{ riderRef, name }`.
 */
function parseUnmapped(raw: unknown): UnmappedRider[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const unmapped: UnmappedRider[] = [];
  for (const item of raw) {
    if (typeof item === "object" && item !== null) {
      const candidate = item as { riderRef?: unknown; name?: unknown };
      if (typeof candidate.riderRef === "string" && candidate.riderRef.length > 0) {
        unmapped.push({
          riderRef: candidate.riderRef,
          name:
            typeof candidate.name === "string" && candidate.name.length > 0
              ? candidate.name
              : null,
        });
      }
    }
  }
  return unmapped;
}

/**
 * Normaliza un nombre de GP/evento para el match de `linkSource`
 * (ADR-0019): minúsculas, sin acentos, sin puntuación.
 */
function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  private readonly source: ResultsSource | undefined;
  private readonly eventCatalog: SourceEventCatalog | undefined;

  constructor(deps: ResultsServiceDeps) {
    this.prisma = deps.prisma;
    this.source = deps.source;
    this.eventCatalog = deps.eventCatalog;
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

  // ── US-17 (ADR-0019): auto-import desde la fuente ──────────────────────────

  /**
   * Importación automática de resultados de un evento desde la fuente
   * (US-17, ADR-0019).
   *
   * El fetch ocurre FUERA de la transacción (I/O de red). Dentro de la
   * transacción: `FOR UPDATE` del GP + gates + mapeo `riderRef → riderId`
   * (`rider_mappings`) + diff mínimo. El manual gana al auto: el auto solo
   * crea filas inexistentes y actualiza filas con `source: "auto"`; nunca
   * toca `source: "manual"` (se conservan y se reportan como `kept`). Los
   * pilotos sin mapeo se saltan y se reportan (`unmapped`).
   *
   * `source_state` se actualiza en cada intento (también no-op): el éxito
   * restablece `consecutiveFailures` a 0. Los fallos de fetch los registra
   * `recordSourceFailure` (lo llama el job).
   */
  async importEventFromSource(
    gpId: string,
    event: ResultEventKind,
    options: { now?: Date } = {},
  ): Promise<ImportEventFromSourceResult> {
    if (!this.source) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No hay fuente de resultados configurada para el auto-import.",
      });
    }
    const source = this.source;
    const now = options.now ?? new Date();
    const sourceLabel = source.meta.name;
    const sourceName = `${source.meta.name}:${source.meta.version}`;

    // Fetch fuera de la transacción (I/O de red, ADR-0019).
    const fetched = await source.fetchEventResults(gpId, event);

    // Mapeo riderRef → riderId (source = source.meta.name).
    const mappings = await this.prisma.riderMapping.findMany({
      where: { source: sourceLabel },
    });
    const riderIdByRef = new Map(mappings.map((m) => [m.riderRef, m.riderId]));

    // Entradas del núcleo: sin mapeo se saltan (y se reportan); los
    // riderIds duplicados (dos refs al mismo piloto) se descartan.
    const entries: ResultEntry[] = [];
    const unmapped: UnmappedRider[] = [];
    const rawByRiderId = new Map<string, Record<string, unknown>>();
    const seenRiderIds = new Set<string>();
    for (const entry of fetched.entries) {
      const riderId = riderIdByRef.get(entry.riderRef);
      if (!riderId) {
        unmapped.push({
          riderRef: entry.riderRef,
          name: riderNameFromRaw(entry.raw),
        });
        continue;
      }
      if (seenRiderIds.has(riderId)) {
        continue; // Anti-duplicado: un piloto aparece una vez por evento.
      }
      seenRiderIds.add(riderId);
      rawByRiderId.set(riderId, entry.raw);
      entries.push({
        riderId,
        position: entry.position,
        started: entry.started,
        finished: entry.finished,
        penalties: [...entry.penalties],
        bonuses: [...entry.bonuses],
        rawPoints: entry.rawPoints,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Bloqueo de la fila del GP (igual que la importación manual).
      const rows = await tx.$queryRaw<Array<{ id: string; status: GpDbStatus }>>`
        SELECT id, status
        FROM gps
        WHERE id = ${gpId}::uuid
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

      // 2. El evento existe en el GP y no está cancelado.
      const weekendEvent = await tx.weekendEvent.findFirst({
        where: { gpId, type: event },
      });
      if (!weekendEvent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `El GP no tiene evento ${resultEventLabel(event)}.`,
        });
      }
      if (weekendEvent.status === "cancelled") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `El evento ${resultEventLabel(event)} está cancelado: no se pueden importar resultados.`,
        });
      }

      // 3. Validación semántica por entrada (núcleo puro); rechazo atómico.
      const errors: string[] = [];
      for (const entry of entries) {
        for (const error of validateEntryForEvent(entry, event)) {
          errors.push(`${entry.riderId}: ${error}`);
        }
      }
      if (errors.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errors.join(" "),
        });
      }

      // 4. Filas actuales + diff mínimo (núcleo puro).
      const existingRows = await tx.result.findMany({
        where: { gpId, eventId: weekendEvent.id },
      });
      const diff = diffResults(existingRows.map(entryFromRow), entries);

      // El manual gana al auto (ADR-0019): solo se corrigen filas auto;
      // las manuales con valores distintos se conservan (`kept`).
      const autoRiderIds = new Set(
        existingRows
          .filter((row) => row.source === "auto")
          .map((row) => row.riderId),
      );
      const corrected = diff.changed.filter((c) => autoRiderIds.has(c.riderId));
      const keptManual = diff.changed.length - corrected.length;
      const hasWrites = diff.created.length > 0 || corrected.length > 0;

      // 5. Creación de filas (`source: "auto"`, `raw` con el payload fuente).
      for (const entry of diff.created) {
        await tx.result.create({
          data: {
            gpId,
            eventId: weekendEvent.id,
            riderId: entry.riderId,
            position: entry.position,
            rawPoints: entry.rawPoints,
            status: "provisional",
            resultsVersion: null,
            source: "auto",
            sourceName,
            raw: {
              ...valuesToJson(entry),
              sourcePayload: rawByRiderId.get(entry.riderId) ?? null,
            } as Prisma.InputJsonObject,
          },
        });
      }

      // 6. Correcciones (solo filas auto) + `results_history`.
      for (const change of corrected) {
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
            source: "auto",
            sourceName,
            raw: {
              ...valuesToJson(change.after),
              sourcePayload: rawByRiderId.get(change.riderId) ?? null,
            } as Prisma.InputJsonObject,
          },
        });
        await tx.resultsHistory.create({
          data: {
            resultId: row.id,
            beforeData: valuesToJson(change.before),
            afterData: valuesToJson(change.after),
            reason: AUTO_IMPORT_REASON,
            resultsVersion: row.resultsVersion,
            userId: null,
          },
        });
      }

      // 7. Efectos + auditoría solo si hubo escrituras (no-op sin rastro).
      if (hasWrites) {
        await tx.resultsEvent.upsert({
          where: { gpId_eventId: { gpId, eventId: weekendEvent.id } },
          update: { status: "finished" },
          create: {
            gpId,
            eventId: weekendEvent.id,
            status: "finished",
          },
        });
        await tx.weekendEvent.updateMany({
          where: { id: weekendEvent.id, status: "scheduled" },
          data: { status: "finished" },
        });
        if (corrected.length > 0) {
          await appendAudit(tx, {
            actorId: null,
            action: "results.correct",
            entity: "results",
            entityId: weekendEvent.id,
            beforeData: {
              gpId,
              eventId: weekendEvent.id,
              corrections: corrected.map((c) => ({
                riderId: c.riderId,
                before: valuesToJson(c.before),
              })),
            },
            afterData: {
              gpId,
              eventId: weekendEvent.id,
              corrections: corrected.map((c) => ({
                riderId: c.riderId,
                after: valuesToJson(c.after),
              })),
              source: sourceName,
            },
          });
        } else {
          await appendAudit(tx, {
            actorId: null,
            action: "results.import",
            entity: "results",
            entityId: weekendEvent.id,
            afterData: {
              gpId,
              eventId: weekendEvent.id,
              entries: entries.map(entryToJson),
              source: sourceName,
            },
          });
        }
      }

      // 8. `source_state`: siempre se actualiza en éxito (también no-op).
      //    Los sin mapeo se reportan y persisten hasta un éxito limpio
      //    (`Prisma.DbNull` = SQL NULL en la columna Json).
      const lastUnmapped = unmapped.length > 0 ? unmapped : Prisma.DbNull;
      await tx.sourceState.upsert({
        where: { gpId_event_source: { gpId, event, source: sourceLabel } },
        create: {
          gpId,
          event,
          source: sourceLabel,
          consecutiveFailures: 0,
          lastAttemptAt: now,
          lastSuccessAt: now,
          lastUnmapped,
        },
        update: {
          consecutiveFailures: 0,
          lastAttemptAt: now,
          lastSuccessAt: now,
          lastUnmapped,
        },
      });

      return {
        created: diff.created.length,
        corrected: corrected.length,
        unchanged: diff.unchanged.length,
        kept: diff.kept.length + keptManual,
        unmapped,
      };
    });
  }

  /**
   * Registra un fallo del auto-import en `source_state` (ADR-0019):
   * `consecutiveFailures + 1`, `lastError` (truncado a 500 caracteres) y
   * `lastAttemptAt`. Lo llama el job cuando el fetch de la fuente lanza.
   * Devuelve el contador nuevo (para la alerta a N fallos consecutivos).
   */
  async recordSourceFailure(
    gpId: string,
    event: ResultEventKind,
    errorMessage: string,
    options: { now?: Date } = {},
  ): Promise<number> {
    const now = options.now ?? new Date();
    const sourceLabel = this.source?.meta.name ?? "pulselive";
    const row = await this.prisma.sourceState.upsert({
      where: { gpId_event_source: { gpId, event, source: sourceLabel } },
      create: {
        gpId,
        event,
        source: sourceLabel,
        consecutiveFailures: 1,
        lastError: errorMessage.slice(0, 500),
        lastAttemptAt: now,
      },
      update: {
        consecutiveFailures: { increment: 1 },
        lastError: errorMessage.slice(0, 500),
        lastAttemptAt: now,
      },
    });
    return row.consecutiveFailures;
  }

  /**
   * Vincula un GP a un evento de la fuente (`Gp.sourceRef`, ADR-0019).
   *
   * `eventRef` explícito o, si se omite, match único por nombre normalizado
   * contra el catálogo de la fuente de la temporada del GP. Cero o varios
   * matches → `BAD_REQUEST` (se pide `eventRef` explícito). Auditado
   * (`results.link_source`).
   */
  async linkSource(
    input: LinkSourceInput,
    meta: ResultsMeta,
  ): Promise<{ gpId: string; sourceRef: string }> {
    return this.prisma.$transaction(async (tx) => {
      const gp = await tx.gp.findUnique({
        where: { id: input.gpId },
        select: {
          id: true,
          name: true,
          sourceRef: true,
          season: { select: { year: true } },
        },
      });
      if (!gp) {
        throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
      }

      let eventRef = input.eventRef;
      if (!eventRef) {
        if (!this.eventCatalog) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "No hay catálogo de eventos de la fuente configurado: indica eventRef explícitamente.",
          });
        }
        const events = await this.eventCatalog.listSeasonEvents(gp.season.year);
        const target = normalizeEventName(gp.name);
        const matches = events.filter((e) => normalizeEventName(e.name) === target);
        if (matches.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No hay ningún evento de la fuente que coincida con el GP «${gp.name}» de la temporada ${gp.season.year}. Indica eventRef explícitamente.`,
          });
        }
        if (matches.length > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Varios eventos de la fuente coinciden con el GP «${gp.name}»: ${matches.map((m) => m.name).join(" | ")}. Indica eventRef explícitamente.`,
          });
        }
        eventRef = matches[0]!.eventRef;
      }

      await tx.gp.update({
        where: { id: gp.id },
        data: { sourceRef: eventRef },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "results.link_source",
        entity: "gp",
        entityId: gp.id,
        beforeData: { sourceRef: gp.sourceRef },
        afterData: { sourceRef: eventRef },
        ip: meta.ip,
      });
      return { gpId: gp.id, sourceRef: eventRef };
    });
  }

  /**
   * Desvincula un GP de la fuente (`Gp.sourceRef = null`, ADR-0019).
   * Auditado (`results.unlink_source`).
   */
  async unlinkSource(
    input: UnlinkSourceInput,
    meta: ResultsMeta,
  ): Promise<{ gpId: string; sourceRef: null }> {
    return this.prisma.$transaction(async (tx) => {
      const gp = await tx.gp.findUnique({
        where: { id: input.gpId },
        select: { id: true, name: true, sourceRef: true },
      });
      if (!gp) {
        throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
      }
      await tx.gp.update({
        where: { id: gp.id },
        data: { sourceRef: null },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "results.unlink_source",
        entity: "gp",
        entityId: gp.id,
        beforeData: { sourceRef: gp.sourceRef },
        afterData: { sourceRef: null },
        ip: meta.ip,
      });
      return { gpId: gp.id, sourceRef: null };
    });
  }

  /**
   * Asocia un piloto de la fuente con un piloto del mercado
   * (`rider_mappings`, ADR-0019). El piloto del mercado debe existir.
   * Auditado (`results.rider_mapping.set`).
   */
  async setRiderMapping(
    input: SetRiderMappingInput,
    meta: ResultsMeta,
  ): Promise<RiderMappingView> {
    const sourceLabel = this.source?.meta.name;
    if (!sourceLabel) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No hay fuente de resultados configurada para los mapeos de pilotos.",
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const rider = await tx.rider.findUnique({
        where: { id: input.riderId },
        select: { id: true, name: true },
      });
      if (!rider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "El piloto del mercado no existe.",
        });
      }
      const previous = await tx.riderMapping.findUnique({
        where: {
          source_riderRef: { source: sourceLabel, riderRef: input.riderRef },
        },
      });
      await tx.riderMapping.upsert({
        where: {
          source_riderRef: { source: sourceLabel, riderRef: input.riderRef },
        },
        create: {
          source: sourceLabel,
          riderRef: input.riderRef,
          riderId: rider.id,
        },
        update: { riderId: rider.id },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "results.rider_mapping.set",
        entity: "rider_mapping",
        entityId: `${sourceLabel}:${input.riderRef}`,
        beforeData: previous ? { riderId: previous.riderId } : null,
        afterData: {
          riderRef: input.riderRef,
          riderId: rider.id,
          riderName: rider.name,
        },
        ip: meta.ip,
      });
      return {
        source: sourceLabel,
        riderRef: input.riderRef,
        riderId: rider.id,
        riderName: rider.name,
      };
    });
  }

  /**
   * Elimina la asociación de un piloto de la fuente (`rider_mappings`,
   * ADR-0019). Auditado (`results.rider_mapping.delete`).
   */
  async deleteRiderMapping(
    input: DeleteRiderMappingInput,
    meta: ResultsMeta,
  ): Promise<void> {
    const sourceLabel = this.source?.meta.name;
    if (!sourceLabel) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No hay fuente de resultados configurada para los mapeos de pilotos.",
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const mapping = await tx.riderMapping.findUnique({
        where: {
          source_riderRef: { source: sourceLabel, riderRef: input.riderRef },
        },
      });
      if (!mapping) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No existe el mapeo para ese piloto de la fuente.",
        });
      }
      await tx.riderMapping.delete({
        where: {
          source_riderRef: { source: sourceLabel, riderRef: input.riderRef },
        },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "results.rider_mapping.delete",
        entity: "rider_mapping",
        entityId: `${sourceLabel}:${input.riderRef}`,
        beforeData: { riderRef: input.riderRef, riderId: mapping.riderId },
        afterData: null,
        ip: meta.ip,
      });
    });
  }

  /**
   * Estado operativo del auto-import de un GP (UI de admin, US-17):
   * fallos consecutivos, último error y pilotos sin mapear (por evento).
   */
  async sourceState(input: SourceStateInput): Promise<SourceStateView[]> {
    const gp = await this.prisma.gp.findUnique({
      where: { id: input.gpId },
      select: { id: true },
    });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    const rows = await this.prisma.sourceState.findMany({
      where: { gpId: input.gpId },
      orderBy: { event: "asc" },
    });
    return rows.map((row) => ({
      event: row.event as ResultEventKind,
      source: row.source,
      consecutiveFailures: row.consecutiveFailures,
      lastError: row.lastError,
      lastAttemptAt: row.lastAttemptAt,
      lastSuccessAt: row.lastSuccessAt,
      lastUnmapped: parseUnmapped(row.lastUnmapped),
    }));
  }

  /**
   * Mapeos de pilotos actuales (UI de admin, US-17). Si hay fuente
   * configurada, solo muestra la de esa fuente.
   */
  async riderMappings(): Promise<RiderMappingView[]> {
    const rows = await this.prisma.riderMapping.findMany({
      where: this.source ? { source: this.source.meta.name } : undefined,
      include: { rider: { select: { name: true } } },
      orderBy: [{ source: "asc" }, { riderRef: "asc" }],
    });
    return rows.map((row) => ({
      source: row.source,
      riderRef: row.riderRef,
      riderId: row.riderId,
      riderName: row.rider.name,
    }));
  }

  /**
   * Eventos de la fuente de la temporada del GP (UI de admin: `linkSource`,
   * US-17).
   */
  async sourceEvents(
    input: SourceEventsInput,
  ): Promise<Array<{ eventRef: string; name: string }>> {
    if (!this.eventCatalog) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No hay catálogo de eventos de la fuente configurado.",
      });
    }
    const gp = await this.prisma.gp.findUnique({
      where: { id: input.gpId },
      select: { id: true, season: { select: { year: true } } },
    });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    return this.eventCatalog.listSeasonEvents(gp.season.year);
  }

  /**
   * Avisos de recálculo para el dashboard (US-15): GPs donde el usuario
   * tiene lineup guardado y hay correcciones en `results_history`
   * (anterior→nuevo, motivo, actor). Sin lineups ni correcciones → `[]`.
   *
   * Solo lectura: no toca `results_version` ni recalcula (eso es US-19).
   */
  async recalculationNotices(userId: string): Promise<RecalculationNotice[]> {
    const lineups = await this.prisma.lineup.findMany({
      where: { userId },
      select: { gpId: true },
    });
    if (lineups.length === 0) return [];
    const gpIds = [...new Set(lineups.map((l) => l.gpId))];

    const rows = await this.prisma.resultsHistory.findMany({
      where: { result: { gpId: { in: gpIds } } },
      select: {
        createdAt: true,
        result: {
          select: {
            gpId: true,
            gp: {
              select: {
                name: true,
                round: true,
                season: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const byGp = new Map<
      string,
      {
        gpName: string;
        round: number;
        seasonName: string;
        corrections: number;
        lastAt: Date;
      }
    >();
    for (const row of rows) {
      const entry = byGp.get(row.result.gpId);
      if (entry) {
        entry.corrections += 1;
        if (row.createdAt > entry.lastAt) entry.lastAt = row.createdAt;
      } else {
        byGp.set(row.result.gpId, {
          gpName: row.result.gp.name,
          round: row.result.gp.round,
          seasonName: row.result.gp.season.name,
          corrections: 1,
          lastAt: row.createdAt,
        });
      }
    }

    return [...byGp.entries()]
      .map(([gpId, e]) => ({
        gpId,
        gpName: e.gpName,
        round: e.round,
        seasonName: e.seasonName,
        corrections: e.corrections,
        lastAt: e.lastAt,
      }))
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  }
}
