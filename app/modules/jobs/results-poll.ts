/**
 * Job de polling de importación automática de resultados (US-17, ADR-0019):
 * solo consulta GPs cuya carrera cae en la ventana de fin de semana
 * `[now − 48h, now + 24h]` (UTC; PROVISIONAL, configurable en
 * `shared/config/results-poll`).
 *
 * Para cada (GP, evento q2/sprint/race) en la ventana se intenta el
 * auto-import vía `resultsService.importEventFromSource` (fetch de la
 * fuente + mapeo de pilotos + import en transacción, `source: "auto"`).
 * Resultados por (GP, evento):
 * - `imported`: el import tuvo éxito (aunque sea no-op).
 * - `skipped`: el GP no está vinculado a la fuente (`not-linked`) o la
 *   sesión no ha terminado (`session-not-finished`): estados esperados,
 *   NO cuentan como fallo.
 * - `failed`: error de la fuente (red, HTTP, normalización, validación):
 *   `recordSourceFailure` incrementa `consecutiveFailures` en
 *   `source_state`; al alcanzar el umbral (N) se emite una alerta para la
 *   UI de admin.
 *
 * Sin lock store adicional: el `FOR UPDATE` de la fila del GP dentro de la
 * transacción de import (ADR-0018) serializa con los imports manuales
 * concurrentes. `now` se inyecta (testable sin reloj real).
 *
 * Orquesta el módulo `results`; nunca al revés (dirección de
 * dependencias: `jobs/` orquesta módulos).
 */
import type { PrismaClient } from "@prisma/client";

import type { ResultEventKind } from "@/shared/types";
import {
  PROVISIONAL_RESULTS_POLL,
  type ResultsPollConfig,
} from "@/shared/config";
import {
  SourceNotLinkedError,
  SourceSessionNotFinishedError,
  type ImportEventFromSourceResult,
} from "@/modules/results";

/**
 * Contrato mínimo del servicio que usa el job (US-17, ADR-0019):
 * `ResultsService` lo satisface estructuralmente.
 */
export interface ResultsPollService {
  importEventFromSource(
    gpId: string,
    event: ResultEventKind,
    options?: { now?: Date },
  ): Promise<ImportEventFromSourceResult>;
  recordSourceFailure(
    gpId: string,
    event: ResultEventKind,
    errorMessage: string,
    options?: { now?: Date },
  ): Promise<number>;
}

export interface ResultsPollDeps {
  prisma: PrismaClient;
  resultsService: ResultsPollService;
}

/** Motivos de `skipped` (estados esperados, no fallos). */
export type PollSkipReason = "not-linked" | "session-not-finished";

/** Resultado de intentar el auto-import de un (GP, evento). */
export type PollOutcome =
  | {
      kind: "imported";
      gpId: string;
      event: ResultEventKind;
      result: ImportEventFromSourceResult;
    }
  | {
      kind: "skipped";
      gpId: string;
      event: ResultEventKind;
      reason: PollSkipReason;
    }
  | {
      kind: "failed";
      gpId: string;
      event: ResultEventKind;
      error: string;
      consecutiveFailures: number;
    };

/** Alerta para la UI de admin al alcanzar el umbral de fallos. */
export interface PollAlert {
  gpId: string;
  event: ResultEventKind;
  consecutiveFailures: number;
  lastError: string;
}

export interface PollResultsResult {
  now: Date;
  window: { from: Date; to: Date };
  outcomes: PollOutcome[];
  alerts: PollAlert[];
}

const MS_PER_HOUR = 3_600_000;

/**
 * Ejecuta un ciclo de polling (US-17, ADR-0019).
 *
 * 1. GPs (cualquier temporada) con `date` (carrera) en
 *    `[now − windowBeforeHours, now + windowAfterHours]`, no `cancelled`,
 *    con sus eventos q2/sprint/race existentes y no `cancelled`.
 * 2. Por (GP, evento): auto-import. `SourceNotLinkedError` y
 *    `SourceSessionNotFinishedError` son skips esperados (no cuentan como
 *    fallo); cualquier otro error se registra en `source_state`
 *    (`recordSourceFailure`) y, al alcanzar el umbral, emite una alerta.
 */
export async function pollResults(
  now: Date,
  deps: ResultsPollDeps,
  config: ResultsPollConfig = PROVISIONAL_RESULTS_POLL,
): Promise<PollResultsResult> {
  const from = new Date(now.getTime() - config.windowBeforeHours * MS_PER_HOUR);
  const to = new Date(now.getTime() + config.windowAfterHours * MS_PER_HOUR);

  const gps = await deps.prisma.gp.findMany({
    where: {
      status: { not: "cancelled" },
      date: { gte: from, lte: to },
    },
    include: {
      weekendEvents: {
        where: {
          type: { in: ["q2", "sprint", "race"] },
          status: { not: "cancelled" },
        },
        orderBy: { orderNum: "asc" },
      },
    },
  });

  const outcomes: PollOutcome[] = [];
  const alerts: PollAlert[] = [];

  for (const gp of gps) {
    for (const event of gp.weekendEvents) {
      const kind = event.type as ResultEventKind;
      try {
        const result = await deps.resultsService.importEventFromSource(
          gp.id,
          kind,
          { now },
        );
        outcomes.push({
          kind: "imported",
          gpId: gp.id,
          event: kind,
          result,
        });
      } catch (error) {
        if (error instanceof SourceNotLinkedError) {
          outcomes.push({
            kind: "skipped",
            gpId: gp.id,
            event: kind,
            reason: "not-linked",
          });
          continue;
        }
        if (error instanceof SourceSessionNotFinishedError) {
          outcomes.push({
            kind: "skipped",
            gpId: gp.id,
            event: kind,
            reason: "session-not-finished",
          });
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        const consecutiveFailures = await deps.resultsService.recordSourceFailure(
          gp.id,
          kind,
          message,
          { now },
        );
        outcomes.push({
          kind: "failed",
          gpId: gp.id,
          event: kind,
          error: message,
          consecutiveFailures,
        });
        if (consecutiveFailures >= config.failureAlertThreshold) {
          alerts.push({
            gpId: gp.id,
            event: kind,
            consecutiveFailures,
            lastError: message.slice(0, 500),
          });
        }
      }
    }
  }

  return { now, window: { from, to }, outcomes, alerts };
}
