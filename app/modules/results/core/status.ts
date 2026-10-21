/**
 * Derivación del estado de puntuación de una entrada — FÓRMULA PURA (sin I/O).
 *
 * ADR-0018: el estado se DERIVA de `started`/`finished`; nunca se importa:
 *
 * - `finished` → FINISHED (posición ≥ 1).
 * - `started ∧ ¬finished` → DNF (carrera principal: 0 − 5, lo deriva el motor).
 * - `¬started` → ABSENT (no partícipe: 0, sin penalización).
 */

import type { GpStatus } from "@/shared/types";

import type { ResultValues } from "./types";

/** Deriva el estado de puntuación de una entrada (ADR-0018). */
export function deriveStatus(
  values: Pick<ResultValues, "started" | "finished">,
): GpStatus {
  if (values.finished) {
    return "FINISHED";
  }
  return values.started ? "DNF" : "ABSENT";
}
