/**
 * Diferencia mínima entre dos conjuntos de resultados — FÓRMULA PURA (sin I/O).
 *
 * Una re-importación reemplaza las entradas indicadas; el servicio aplica
 * la diferencia mínima (ADR-0018):
 *
 * - Pilotos en el payload pero no en BD = `created` (fila nueva).
 * - Pilotos en ambos con valores distintos = `changed` (actualización +
 *   `results_history` antes→nuevo + motivo + actor; `definitive` pasa a
 *   `corrected`, `provisional` se mantiene).
 * - Pilotos en ambos con valores idénticos = `unchanged` (no-op: sin
 *   escritura, sin auditoría, sin histórico).
 * - Pilotos en BD pero no en el payload = `kept` (se conservan: los
 *   resultados no se borran, se corrigen).
 *
 * La comparación de valores es por CONJUNTO para los códigos (el orden no
 * importa): `position`, `started`, `finished`, `rawPoints` y los conjuntos
 * de `penalties`/`bonuses`.
 */

import type { ResultEntry, ResultValues } from "./types";

/** Resultado de la diferencia (ADR-0018). */
export interface ResultDiff {
  /** Pilotos a crear (en el payload, no en BD). */
  created: ResultEntry[];
  /** Pilotos a actualizar (en ambos, con valores distintos). */
  changed: Array<{ riderId: string; before: ResultValues; after: ResultValues }>;
  /** Pilotos con valores idénticos (no-op). */
  unchanged: string[];
  /** Pilotos en BD no presentes en el payload (se conservan). */
  kept: string[];
}

/** Compara dos conjuntos de valores (códigos por conjunto: el orden no importa). */
export function sameResultValues(a: ResultValues, b: ResultValues): boolean {
  return (
    a.position === b.position &&
    a.started === b.started &&
    a.finished === b.finished &&
    a.rawPoints === b.rawPoints &&
    sameCodes(a.penalties, b.penalties) &&
    sameCodes(a.bonuses, b.bonuses)
  );
}

/** Calcula la diferencia mínima entre filas existentes y entradas entrantes. */
export function diffResults(existing: ResultEntry[], incoming: ResultEntry[]): ResultDiff {
  const existingByRider = new Map(existing.map((e) => [e.riderId, e]));
  const incomingRiders = new Set(incoming.map((e) => e.riderId));

  const created: ResultEntry[] = [];
  const changed: ResultDiff["changed"] = [];
  const unchanged: string[] = [];
  const kept: string[] = [];

  for (const entry of incoming) {
    const prev = existingByRider.get(entry.riderId);
    if (!prev) {
      created.push(entry);
      continue;
    }
    if (sameResultValues(prev, entry)) {
      unchanged.push(entry.riderId);
    } else {
      changed.push({
        riderId: entry.riderId,
        before: valuesOf(prev),
        after: valuesOf(entry),
      });
    }
  }
  for (const row of existing) {
    if (!incomingRiders.has(row.riderId)) {
      kept.push(row.riderId);
    }
  }

  return { created, changed, unchanged, kept };
}

/** Extrae solo los valores de una entrada (sin `riderId`). */
function valuesOf(entry: ResultEntry): ResultValues {
  return {
    position: entry.position,
    started: entry.started,
    finished: entry.finished,
    penalties: entry.penalties,
    bonuses: entry.bonuses,
    rawPoints: entry.rawPoints,
  };
}

/** Dos listas de códigos son iguales como conjuntos (sin duplicados). */
function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((code) => set.has(code));
}
