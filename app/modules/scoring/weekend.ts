/**
 * Puntuación de fin de semana completo — FÓRMULAS PURAS (scoring-v1).
 *
 * US-18 (ADR-0020): extiende el motor de la carrera principal (engine.ts) al
 * fin de semana completo de `docs/product/scoring.md` §2: Q2 + sprint +
 * carrera principal + bonos (ganador, vuelta rápida, pole, posiciones
 * ganadas, extraordinario) − penalizaciones (DNF, DQ, tiempo).
 *
 * Los VALORES de tablas/bonos/penalizaciones los aporta `season_rules`
 * (versionado por temporada; AGENTS.md §1.3): el motor solo recibe datos y
 * devuelve resultados. Sin I/O: solo recibe datos y devuelve resultados.
 *
 * Derivados (los calcula el motor; NO se importan, ADR-0018):
 * - Ganador (+winnerBonus): 1º de la carrera principal.
 * - Posiciones ganadas (+positionsGainedBonus por posición, máx
 *   positionsGainedMax): solo si termina; desde la parrilla de Q2.
 * - Extraordinario (+extraordinaryBonus): top-3 de la carrera siendo el
 *   piloto más barato de su equipo.
 * - DNF (−dnfPenalty): `started ∧ ¬finished` en la carrera principal.
 *
 * Importables (los aporta el admin o la fuente): `pole` (q2),
 * `fastest-lap` (race), `dq` (q2/sprint/race), `time-penalty` (sprint/race).
 */

import type { Lineup } from "../../shared/types";

/** Resultado de un piloto en UN evento (q2/sprint/race). */
export interface EventOutcome {
  /** Posición oficial (≥1) o `null` (no clasifica / no termina). */
  position: number | null;
  /** `false` = non-starter (ABSENT: 0, sin penalización). */
  started: boolean;
  /** `true` = termina (FINISHED). */
  finished: boolean;
  /** Códigos de bono importables (p. ej. `pole`, `fastest-lap`). */
  bonuses: readonly string[];
  /** Códigos de penalización importables (p. ej. `dq`, `time-penalty`). */
  penalties: readonly string[];
}

/** Resultados del fin de semana de un piloto (cada evento puede faltar). */
export interface RiderWeekend {
  q2: EventOutcome | null;
  sprint: EventOutcome | null;
  race: EventOutcome | null;
}

/**
 * Reglas de puntuación (estructuralmente idéntico a
 * `SeasonRules["scoring"]` de `shared/validation/season-rules`). El módulo
 * puro no puede importarlo (check de pureza: solo `shared/types`), así que
 * declara su propio tipo; el servicio pasa el objeto parseado.
 */
export interface ScoringRules {
  /** Puntos por posición en Q2 (clasificación). */
  q2: Record<string, number>;
  /** Puntos por posición en la sprint. */
  sprint: Record<string, number>;
  /** Puntos por posición en la carrera principal. */
  mainRace: Record<string, number>;
  /** Bono por ganar la carrera principal. */
  winnerBonus: number;
  /** Bono de vuelta rápida. */
  fastestLapBonus: number;
  /** Bono de pole position. */
  poleBonus: number;
  /** Bono por posición ganada. */
  positionsGainedBonus: number;
  /** Tope del bono de posiciones ganadas. */
  positionsGainedMax: number;
  /** Bono de resultado extraordinario. */
  extraordinaryBonus: number;
  /** Penalización por DNF (carrera principal). */
  dnfPenalty: number;
  /** Penalización por descalificación (DQ). */
  dqPenalty: number;
  /** Penalización de tiempo aplicada. */
  timePenalty: number;
  /** Peso del oro (1.0 = 100%). */
  goldWeight: number;
  /** Peso de la plata (0.5 = 50%). */
  silverWeight: number;
}

/**
 * Contexto entre pilotos necesario para los bonos derivados (US-18):
 * parrilla de Q2 (posiciones ganadas) y equipo/precio (extraordinario).
 */
export interface RiderScoringContext {
  /** Parrilla de Q2 (riderId → posición). Vacía si no hay Q2. */
  q2Grid: Map<string, number>;
  /** Equipo de cada piloto (riderId → teamId). */
  teamOf: Map<string, string>;
  /** Precio de cada piloto (riderId → precio) para el más barato del equipo. */
  priceOf: Map<string, number>;
}

/**
 * Bono/penalización individual del desglose. `type` (no `interface`): el
 * desglose se guarda en `Score.breakdown` (JSONB/Prisma `InputJsonValue`),
 * que exige index signature — solo la dan los alias de tipo de objeto.
 */
export type ScoredCode = {
  /** Código (`pole`, `fastest-lap`, `winner`, `positions-gained`,
   *  `extraordinary`, `dnf`, `dq`, `time-penalty`). */
  code: string;
  /** Puntos (positivo = bono, negativo = penalización). */
  points: number;
};

/** Desglose de los puntos de un piloto en el fin de semana. */
export type RiderPointsBreakdown = {
  /** Puntos de Q2 (tabla de clasificación). */
  q2: number;
  /** Puntos de la sprint (tabla). */
  sprint: number;
  /** Puntos de la carrera principal (tabla; 0 si DNF/ABSENT). */
  mainRace: number;
  /** Bonos (aditivos). */
  bonuses: ScoredCode[];
  /** Penalizaciones (sustractivas; puntos negativos). */
  penalties: ScoredCode[];
  /** Total = q2 + sprint + mainRace + Σbonos − Σpenalizaciones. */
  total: number;
};

/** Puntos de una posición en una tabla (claves como string; 0 si ausente). */
function tablePoints(table: Record<string, number>, position: number | null): number {
  if (position === null) return 0;
  return table[String(position)] ?? 0;
}

/**
 * ¿Es el piloto el más barato de su equipo? (bono extraordinario,
 * scoring.md §2.4). `false` si no tiene equipo o falta algún precio.
 */
export function cheapestInTeam(
  riderId: string,
  teamOf: Map<string, string>,
  priceOf: Map<string, number>,
): boolean {
  const team = teamOf.get(riderId);
  if (team === undefined) return false;
  const price = priceOf.get(riderId);
  if (price === undefined) return false;
  let min = Infinity;
  for (const [rider, riderTeam] of teamOf) {
    if (riderTeam !== team) continue;
    const p = priceOf.get(rider);
    if (p !== undefined && p < min) min = p;
  }
  return min === price;
}

/**
 * Puntos de un piloto en el fin de semana completo (scoring.md §2).
 *
 * - Q2 / sprint / carrera: puntos por posición según las tablas.
 * - Bonos: pole (q2), vuelta rápida (race), ganador (1º race), posiciones
 *   ganadas (race, desde Q2), extraordinario (top-3 race + más barato).
 * - Penalizaciones: DNF (race, `started ∧ ¬finished`), DQ y tiempo
 *   (según los códigos importados, por evento).
 *
 * Un DNF en sprint puntúa 0 según su tabla, sin penalización adicional
 * (scoring.md §2.5 nota). El DNF penaliza solo en la carrera principal.
 */
export function scoreRiderWeekend(
  riderId: string,
  weekend: RiderWeekend,
  rules: ScoringRules,
  ctx: RiderScoringContext,
): RiderPointsBreakdown {
  const { q2, sprint, race } = weekend;

  // Puntos por posición (tablas). DNF/ABSENT → 0 por posición. La DQ anula
  // los puntos de posición del evento (scoring.md §6: "DQ = 0 por posición +
  // penalización −10"), por lo que se evalúa antes de leer la tabla.
  const positionPoints = (
    event: EventOutcome | null,
    table: Record<string, number>,
    requiresFinished: boolean,
  ): number => {
    if (!event) return 0;
    if (event.penalties.includes("dq")) return 0;
    if (requiresFinished && !event.finished) return 0;
    return tablePoints(table, event.position);
  };
  const q2Points = positionPoints(q2, rules.q2, false);
  const sprintPoints = positionPoints(sprint, rules.sprint, false);
  const mainRacePoints = positionPoints(race, rules.mainRace, true);

  const bonuses: ScoredCode[] = [];
  const penalties: ScoredCode[] = [];

  // ── Bonos importados ──────────────────────────────────────────────────
  if (q2?.bonuses.includes("pole")) {
    bonuses.push({ code: "pole", points: rules.poleBonus });
  }
  if (race?.bonuses.includes("fastest-lap")) {
    bonuses.push({ code: "fastest-lap", points: rules.fastestLapBonus });
  }

  // ── Bonos derivados (solo carrera principal terminada) ───────────────
  if (race && race.finished) {
    // Ganador: 1º de la carrera principal.
    if (race.position === 1) {
      bonuses.push({ code: "winner", points: rules.winnerBonus });
    }
    // Posiciones ganadas: desde la parrilla de Q2, máx. positionsGainedMax.
    if (race.position !== null) {
      const gridPos = ctx.q2Grid.get(riderId);
      if (gridPos !== undefined) {
        const gained = gridPos - race.position;
        if (gained > 0) {
          const capped = Math.min(gained, rules.positionsGainedMax);
          bonuses.push({
            code: "positions-gained",
            points: capped * rules.positionsGainedBonus,
          });
        }
      }
    }
    // Extraordinario: top-3 siendo el más barato de su equipo.
    if (race.position !== null && race.position <= 3) {
      if (cheapestInTeam(riderId, ctx.teamOf, ctx.priceOf)) {
        bonuses.push({ code: "extraordinary", points: rules.extraordinaryBonus });
      }
    }
  }

  // ── Penalizaciones ────────────────────────────────────────────────────
  // DNF: solo carrera principal, `started ∧ ¬finished` (scoring.md §2.5).
  // La DQ tiene precedencia (scoring.md §6: DQ = 0 + −10, sin sumar el −5).
  const raceDq = race?.penalties.includes("dq") ?? false;
  if (race && race.started && !race.finished && !raceDq) {
    penalties.push({ code: "dnf", points: -rules.dnfPenalty });
  }
  // DQ y tiempo: según los códigos importados, por evento.
  for (const event of [q2, sprint, race]) {
    if (!event) continue;
    if (event.penalties.includes("dq")) {
      penalties.push({ code: "dq", points: -rules.dqPenalty });
    }
    if (event.penalties.includes("time-penalty")) {
      penalties.push({ code: "time-penalty", points: -rules.timePenalty });
    }
  }

  const bonusTotal = bonuses.reduce((s, b) => s + b.points, 0);
  const penaltyTotal = penalties.reduce((s, p) => s + p.points, 0);

  return {
    q2: q2Points,
    sprint: sprintPoints,
    mainRace: mainRacePoints,
    bonuses,
    penalties,
    total: q2Points + sprintPoints + mainRacePoints + bonusTotal + penaltyTotal,
  };
}

/**
 * Puntos totales de un lineup (scoring.md §4), con los pesos de
 * `season_rules` (oro/plata configurables — AGENTS.md §1.3):
 *
 *   puntos_lineup = Σ_oro (goldWeight × piloto) + Σ_plata (silverWeight ×
 *   piloto) + puntos_constructor + puntos_equipo
 *
 * `riderPoints` son los puntos de fin de semana de cada piloto (el total de
 * `scoreRiderWeekend`); `ctorPoints`/`teamPoints` la media top-2 del grupo
 * (`groupTopTwoAverage`).
 */
export function lineupWeekendPoints(
  lineup: Lineup,
  riderPoints: Map<string, number>,
  ctorPoints: Map<string, number>,
  teamPoints: Map<string, number>,
  weights: { gold: number; silver: number },
): number {
  const get = (id: string): number => riderPoints.get(id) ?? 0;
  const gold = lineup.gold.reduce((s, id) => s + get(id), 0) * weights.gold;
  const silver = lineup.silver.reduce((s, id) => s + get(id), 0) * weights.silver;
  const ctor = ctorPoints.get(lineup.constructor) ?? 0;
  const team = teamPoints.get(lineup.team) ?? 0;
  return gold + silver + ctor + team;
}
