/**
 * Códigos importables por tipo de evento — FÓRMULA PURA (sin I/O).
 *
 * ADR-0018: el admin o la fuente solo aporta un conjunto acotado de
 * códigos; el resto lo deriva el motor de puntuación (US-19):
 *
 * | Código           | Tipo         | Aplica en        | Condición          |
 * | ---------------- | ------------ | ---------------- | ------------------ |
 * | `pole`           | bono         | q2               | posición ≥ 1       |
 * | `fastest-lap`    | bono         | race             | finished           |
 * | `dq`             | penalización | q2, sprint, race | —                  |
 * | `time-penalty`   | penalización | sprint, race     | —                  |
 *
 * Derivados (NO importables): ganador, posiciones ganadas, extraordinario,
 * DNF (−5). Los VALORES de los códigos viven en `season_rules` (versionado
 * por temporada).
 */

import type {
  ResultBonusCode,
  ResultEventKind,
  ResultPenaltyCode,
} from "@/shared/types";

import type { ResultValues } from "./types";

/** Códigos de bono aplicables por tipo de evento (ADR-0018). */
export const BONUS_CODES_BY_EVENT: Record<ResultEventKind, readonly ResultBonusCode[]> = {
  q2: ["pole"],
  sprint: [],
  race: ["fastest-lap"],
};

/** Códigos de penalización aplicables por tipo de evento (ADR-0018). */
export const PENALTY_CODES_BY_EVENT: Record<ResultEventKind, readonly ResultPenaltyCode[]> = {
  q2: ["dq"],
  sprint: ["dq", "time-penalty"],
  race: ["dq", "time-penalty"],
};

/** Etiqueta en español de un evento de resultados (para mensajes de rechazo). */
export function resultEventLabel(event: ResultEventKind): string {
  switch (event) {
    case "q2":
      return "Q2";
    case "sprint":
      return "sprint";
    case "race":
      return "carrera principal";
  }
}

/**
 * Valida una entrada contra el tipo de evento de resultados (ADR-0018).
 *
 * Devuelve los motivos de rechazo en español (array vacío si la entrada es
 * válida). El servicio agrega los errores de todas las entradas y rechaza
 * la importación de forma atómica (todo o nada).
 */
export function validateEntryForEvent(entry: ResultValues, event: ResultEventKind): string[] {
  const errors: string[] = [];
  const label = resultEventLabel(event);

  const allowedBonuses = new Set<string>(BONUS_CODES_BY_EVENT[event]);
  for (const code of entry.bonuses) {
    if (!allowedBonuses.has(code)) {
      errors.push(`El bono «${code}» no es válido en ${label}`);
    }
  }

  const allowedPenalties = new Set<string>(PENALTY_CODES_BY_EVENT[event]);
  for (const code of entry.penalties) {
    if (!allowedPenalties.has(code)) {
      errors.push(`La penalización «${code}» no es válida en ${label}`);
    }
  }

  if (entry.bonuses.includes("fastest-lap") && !entry.finished) {
    errors.push("El bono de vuelta rápida exige que el piloto haya terminado la carrera");
  }
  if (entry.bonuses.includes("pole") && entry.position === null) {
    errors.push("El bono de pole exige que el piloto haya clasificado (posición en Q2)");
  }

  return errors;
}
