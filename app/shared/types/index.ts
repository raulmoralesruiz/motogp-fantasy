/**
 * Tipos de dominio compartidos entre cliente/servidor y entre módulos.
 *
 * Los módulos puros (`economy`, `scoring`) solo importan de aquí.
 * Los tipos de fixture (datos crudos de la fuente) se usan en la capa de
 * scripts (I/O), no en los módulos puros.
 */

// ---------------------------------------------------------------------------
// Mercado (activos)
// ---------------------------------------------------------------------------

/** Un piloto como activo del mercado. */
export interface RiderAsset {
  riderId: string;
  name: string;
  team: string;
  constructor: string;
  number: number;
}

/** Un constructor como activo del mercado. */
export interface ConstructorAsset {
  name: string;
}

/** Un equipo como activo del mercado. */
export interface TeamAsset {
  name: string;
}

// ---------------------------------------------------------------------------
// Resultados por GP
// ---------------------------------------------------------------------------

export type GpStatus = "FINISHED" | "DNF" | "ABSENT";

/**
 * Eventos que admiten resultados (ADR-0018): Q1 no es un evento de
 * resultados (no aparece en el contrato `ResultsSource`).
 */
export const RESULT_EVENT_KINDS = ["q2", "sprint", "race"] as const;
export type ResultEventKind = (typeof RESULT_EVENT_KINDS)[number];

/**
 * Códigos de bono importables (los aporta el admin o la fuente; ADR-0018).
 * El resto de bonos (ganador, posiciones ganadas, extraordinario) los deriva
 * el motor de puntuación (US-19). Los VALORES viven en `season_rules`.
 */
export const RESULT_BONUS_CODES = ["fastest-lap", "pole"] as const;
export type ResultBonusCode = (typeof RESULT_BONUS_CODES)[number];

/**
 * Códigos de penalización importables (ADR-0018). El DNF (−5) lo deriva el
 * motor desde `started ∧ ¬finished` en la carrera principal. Los VALORES
 * viven en `season_rules`.
 */
export const RESULT_PENALTY_CODES = ["dq", "time-penalty"] as const;
export type ResultPenaltyCode = (typeof RESULT_PENALTY_CODES)[number];

/** Resultado de un piloto en la carrera principal de un GP. */
export interface GpResult {
  riderId: string;
  position: number | null;
  status: GpStatus;
  laps: number;
}

/** Un GP con sus resultados de carrera principal. */
export interface Gp {
  order: number;
  shortName: string;
  name: string;
  date: string;
  results: GpResult[];
}

// ---------------------------------------------------------------------------
// Lineup
// ---------------------------------------------------------------------------

/**
 * Lineup de un jugador para un GP: 2 oro + 2 plata + 1 constructor + 1 equipo.
 * `gold` y `silver` son riderId.
 */
export interface Lineup {
  gold: [string, string];
  silver: [string, string];
  constructor: string;
  team: string;
}

// ---------------------------------------------------------------------------
// Fixtures (datos crudos de la fuente — solo capa de scripts)
// ---------------------------------------------------------------------------

export interface StandingEntry {
  riderId: string;
  name: string;
  points: number;
  team?: string;
  constructor?: string;
}

/** Fixture de la temporada en curso (2026): GPs con resultados + roster. */
export interface SeasonFixture {
  year: number;
  seasonUuid: string;
  categoryUuid: string;
  fetchedAt: string;
  gps: Gp[];
  roster: RiderAsset[];
  standings: StandingEntry[];
}

/** Fixture de la temporada anterior (2025): clasificación para P0. */
export interface PrevSeasonFixture {
  year: number;
  seasonUuid: string;
  categoryUuid: string;
  fetchedAt: string;
  standings: StandingEntry[];
}
