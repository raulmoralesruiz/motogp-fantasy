/**
 * Tipos del núcleo puro de `results` (sin I/O) — Fase 3 (ADR-0018).
 *
 * El núcleo opera sobre datos ya cargados y validados (entradas de import,
 * filas existentes) y devuelve resultados. No toca BD, reloj ni red: la
 * capa de servicio del módulo `results` es la que orquesta con Prisma.
 */

import type { ResultBonusCode, ResultPenaltyCode } from "@/shared/types";

/**
 * Valores normalizados de una entrada de resultados (ADR-0018).
 *
 * Son los valores que se guardan en la columna `results.raw` (Json), más
 * las columnas desnormalizadas `position`/`rawPoints`. NO incluye
 * `riderId`: la fila ya lo tiene como columna.
 */
export interface ResultValues {
  /** Posición final (≥ 1). `null` si el piloto no terminó (DNF/ABSENT). */
  position: number | null;
  /** ¿Salió el piloto en el evento? `false` → ABSENT (no partícipe). */
  started: boolean;
  /** ¿Terminó el piloto el evento? `true` → FINISHED (posición ≥ 1). */
  finished: boolean;
  /** Códigos de penalización importados (los valores viven en `season_rules`). */
  penalties: readonly ResultPenaltyCode[];
  /** Códigos de bono importados (los valores viven en `season_rules`). */
  bonuses: readonly ResultBonusCode[];
  /** Puntos oficiales de la fuente (auditoría); `null` si no aporta. */
  rawPoints: number | null;
}

/** Entrada de resultados: piloto + valores (lo que aporta la importación). */
export interface ResultEntry extends ResultValues {
  riderId: string;
}
