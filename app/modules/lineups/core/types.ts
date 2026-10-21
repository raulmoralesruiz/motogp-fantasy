/**
 * Tipos del núcleo puro de lineups (sin I/O) — Fase 2 (ADR-0017).
 *
 * El núcleo opera sobre datos ya cargados (slots, afiliaciones del GP,
 * precios congelados, movimientos de presupuesto) y devuelve resultados.
 * No toca BD, reloj ni red: la capa de servicio del módulo `lineups` es la
 * que orquesta con Prisma.
 */

/** Tipos de activo del mercado (invariante 5: constructor ≠ equipo). */
export type AssetKind = "rider" | "constructor" | "team";

/** Slots de un lineup para un GP (input de validación y coste). */
export interface LineupSlots {
  /** IDs de pilotos oro (se esperan exactamente 2). */
  gold: readonly string[];
  /** IDs de pilotos plata (se esperan exactamente 2). */
  silver: readonly string[];
  /** ID del constructor (se espera 1). */
  constructorId: string | null;
  /** ID del equipo (se espera 1). */
  teamId: string | null;
}

/** Afiliación de un piloto en un GP (rider → equipo + constructor). */
export interface RiderAffiliation {
  riderId: string;
  teamId: string;
  constructorId: string;
}

/** Límites de concentración (season_rules.limits, PROVISIONAL). */
export interface ConcentrationLimits {
  maxPerConstructor: number;
  maxPerTeam: number;
}

/** Precio congelado de un activo para un GP (ADR-0015). */
export interface GpPrice {
  assetType: AssetKind;
  assetId: string;
  price: number;
}

/** Movimiento de presupuesto (espejo puro de `budget_movements`). */
export type BudgetMovementType = "base" | "carry" | "spend" | "adjust";

export interface BudgetMovement {
  type: BudgetMovementType;
  /** Importe con signo: base/carry positivos, spend negativo (devolución positiva). */
  amount: number;
}
