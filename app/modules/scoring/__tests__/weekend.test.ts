/**
 * Tests del motor de fin de semana completo (US-18, scoring-v1).
 *
 * Fuente de verdad: `docs/product/scoring.md` §2. Los valores de las reglas
 * son los PROVISIONAL de `shared/config/season-rules.ts` (misma forma que
 * `season_rules` en producción).
 */
import { describe, expect, it } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../../shared/config/season-rules";
import type { Lineup } from "../../../shared/types";
import {
  cheapestInTeam,
  lineupWeekendPoints,
  scoreRiderWeekend,
  type EventOutcome,
  type RiderScoringContext,
  type RiderWeekend,
} from "../index";

const rules = PROVISIONAL_SEASON_RULES.scoring;

/** Contexto vacío (sin parrilla Q2, sin equipos/precios). */
const emptyCtx: RiderScoringContext = {
  q2Grid: new Map(),
  teamOf: new Map(),
  priceOf: new Map(),
};

/** Evento terminado en una posición dada. */
function finished(position: number, extra: Partial<EventOutcome> = {}): EventOutcome {
  return { position, started: true, finished: true, bonuses: [], penalties: [], ...extra };
}

/** Evento DNF (salió, no terminó). */
function dnf(): EventOutcome {
  return { position: null, started: true, finished: false, bonuses: [], penalties: [] };
}

/** Evento non-starter (no salió). */
function absent(): EventOutcome {
  return { position: null, started: false, finished: false, bonuses: [], penalties: [] };
}

describe("scoreRiderWeekend — puntos por posición (tablas)", () => {
  it("Q2: pole (posición 1) = 12", () => {
    const w: RiderWeekend = { q2: finished(1), sprint: null, race: null };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.q2).toBe(12);
    expect(r.total).toBe(12);
  });

  it("Q2: posición 8 = 3", () => {
    const w: RiderWeekend = { q2: finished(8), sprint: null, race: null };
    expect(scoreRiderWeekend("R", w, rules, emptyCtx).q2).toBe(3);
  });

  it("Q2: posición 21 (fuera de tabla) = 0", () => {
    const w: RiderWeekend = { q2: finished(21), sprint: null, race: null };
    expect(scoreRiderWeekend("R", w, rules, emptyCtx).q2).toBe(0);
  });

  it("sprint: posición 1 = 12", () => {
    const w: RiderWeekend = { q2: null, sprint: finished(1), race: null };
    expect(scoreRiderWeekend("R", w, rules, emptyCtx).sprint).toBe(12);
  });

  it("carrera: posición 1 = 25", () => {
    const w: RiderWeekend = { q2: null, sprint: null, race: finished(1) };
    expect(scoreRiderWeekend("R", w, rules, emptyCtx).mainRace).toBe(25);
  });

  it("sin eventos = 0", () => {
    const w: RiderWeekend = { q2: null, sprint: null, race: null };
    expect(scoreRiderWeekend("R", w, rules, emptyCtx).total).toBe(0);
  });
});

describe("scoreRiderWeekend — bonos", () => {
  it("pole (Q2): +2", () => {
    const w: RiderWeekend = { q2: finished(1, { bonuses: ["pole"] }), sprint: null, race: null };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.bonuses).toEqual([{ code: "pole", points: 2 }]);
    expect(r.total).toBe(12 + 2);
  });

  it("vuelta rápida (carrera): +3", () => {
    const w: RiderWeekend = {
      q2: null,
      sprint: null,
      race: finished(2, { bonuses: ["fastest-lap"] }),
    };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.bonuses).toEqual([{ code: "fastest-lap", points: 3 }]);
    expect(r.total).toBe(20 + 3);
  });

  it("ganador (1º carrera): +5", () => {
    const w: RiderWeekend = { q2: null, sprint: null, race: finished(1) };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.bonuses).toEqual([{ code: "winner", points: 5 }]);
    expect(r.total).toBe(25 + 5);
  });

  it("no da bono de ganador si no es 1º", () => {
    const w: RiderWeekend = { q2: null, sprint: null, race: finished(2) };
    expect(scoreRiderWeekend("R", w, rules, emptyCtx).bonuses).toEqual([]);
  });

  it("posiciones ganadas: Q2 5 → carrera 2 = +3", () => {
    const ctx: RiderScoringContext = { ...emptyCtx, q2Grid: new Map([["R", 5]]) };
    const w: RiderWeekend = {
      q2: finished(5),
      sprint: null,
      race: finished(2),
    };
    const r = scoreRiderWeekend("R", w, rules, ctx);
    expect(r.bonuses).toEqual([{ code: "positions-gained", points: 3 }]);
    expect(r.total).toBe(5 + 20 + 3);
  });

  it("posiciones ganadas: tope de 3 (Q2 10 → carrera 1)", () => {
    const ctx: RiderScoringContext = { ...emptyCtx, q2Grid: new Map([["R", 10]]) };
    const w: RiderWeekend = { q2: finished(10), sprint: null, race: finished(1) };
    const r = scoreRiderWeekend("R", w, rules, ctx);
    const gained = r.bonuses.find((b) => b.code === "positions-gained");
    expect(gained?.points).toBe(3);
  });

  it("sin posiciones ganadas si pierde o no hay parrilla Q2", () => {
    // Pierde: Q2 2 → carrera 3.
    const ctx: RiderScoringContext = { ...emptyCtx, q2Grid: new Map([["R", 2]]) };
    const w: RiderWeekend = { q2: finished(2), sprint: null, race: finished(3) };
    expect(scoreRiderWeekend("R", w, rules, ctx).bonuses).toEqual([]);
  });

  it("extraordinario: top-3 + más barato del equipo = +5", () => {
    const ctx: RiderScoringContext = {
      ...emptyCtx,
      teamOf: new Map([["R", "T1"], ["O", "T1"]]),
      priceOf: new Map([["R", 10], ["O", 20]]),
    };
    const w: RiderWeekend = { q2: null, sprint: null, race: finished(2) };
    const r = scoreRiderWeekend("R", w, rules, ctx);
    expect(r.bonuses).toEqual([{ code: "extraordinary", points: 5 }]);
    expect(r.total).toBe(20 + 5);
  });

  it("extraordinario: NO si no es el más barato", () => {
    const ctx: RiderScoringContext = {
      ...emptyCtx,
      teamOf: new Map([["R", "T1"], ["O", "T1"]]),
      priceOf: new Map([["R", 20], ["O", 10]]),
    };
    const w: RiderWeekend = { q2: null, sprint: null, race: finished(2) };
    expect(scoreRiderWeekend("R", w, rules, ctx).bonuses).toEqual([]);
  });

  it("extraordinario: NO si no es top-3", () => {
    const ctx: RiderScoringContext = {
      ...emptyCtx,
      teamOf: new Map([["R", "T1"]]),
      priceOf: new Map([["R", 10]]),
    };
    const w: RiderWeekend = { q2: null, sprint: null, race: finished(4) };
    expect(scoreRiderWeekend("R", w, rules, ctx).bonuses).toEqual([]);
  });

  it("extraordinario: NO si no termina (DNF)", () => {
    const ctx: RiderScoringContext = {
      ...emptyCtx,
      teamOf: new Map([["R", "T1"]]),
      priceOf: new Map([["R", 10]]),
    };
    const w: RiderWeekend = { q2: null, sprint: null, race: dnf() };
    expect(scoreRiderWeekend("R", w, rules, ctx).bonuses).toEqual([]);
  });
});

describe("scoreRiderWeekend — penalizaciones", () => {
  it("DNF (carrera): 0 − 5", () => {
    const w: RiderWeekend = { q2: null, sprint: null, race: dnf() };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.mainRace).toBe(0);
    expect(r.penalties).toEqual([{ code: "dnf", points: -5 }]);
    expect(r.total).toBe(-5);
  });

  it("non-starter (carrera): 0, sin penalización", () => {
    const w: RiderWeekend = { q2: null, sprint: null, race: absent() };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.penalties).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("DNF en sprint: 0, sin penalización (solo carrera penaliza DNF)", () => {
    const w: RiderWeekend = { q2: null, sprint: dnf(), race: null };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.penalties).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("DQ (carrera): 0 − 10, sin sumar el DNF", () => {
    const w: RiderWeekend = {
      q2: null,
      sprint: null,
      race: { position: null, started: true, finished: false, bonuses: [], penalties: ["dq"] },
    };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.penalties).toEqual([{ code: "dq", points: -10 }]);
    expect(r.total).toBe(-10);
  });

  it("DQ en Q2: 0 − 10", () => {
    const w: RiderWeekend = {
      q2: { position: 1, started: true, finished: true, bonuses: [], penalties: ["dq"] },
      sprint: null,
      race: null,
    };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.penalties).toEqual([{ code: "dq", points: -10 }]);
    expect(r.total).toBe(-10);
  });

  it("penalización de tiempo: −2 (conserva puntos de posición)", () => {
    const w: RiderWeekend = {
      q2: null,
      sprint: null,
      race: finished(2, { penalties: ["time-penalty"] }),
    };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.mainRace).toBe(20);
    expect(r.penalties).toEqual([{ code: "time-penalty", points: -2 }]);
    expect(r.total).toBe(20 - 2);
  });

  it("DQ + tiempo en el mismo evento: −12", () => {
    const w: RiderWeekend = {
      q2: null,
      sprint: null,
      race: {
        position: null,
        started: true,
        finished: false,
        bonuses: [],
        penalties: ["dq", "time-penalty"],
      },
    };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    expect(r.penalties).toEqual([
      { code: "dq", points: -10 },
      { code: "time-penalty", points: -2 },
    ]);
    expect(r.total).toBe(-12);
  });
});

describe("scoreRiderWeekend — combinaciones", () => {
  it("fin de semana completo: Q2 + sprint + carrera + bonos", () => {
    // q2Grid coherente con la posición de Q2 (1) → no gana posiciones.
    const ctx: RiderScoringContext = { ...emptyCtx, q2Grid: new Map([["R", 1]]) };
    const w: RiderWeekend = {
      q2: finished(1, { bonuses: ["pole"] }),
      sprint: finished(1),
      race: finished(1),
    };
    const r = scoreRiderWeekend("R", w, rules, ctx);
    // Q2: 12 + pole 2 = 14; sprint: 12; carrera: 25 + ganador 5 = 30.
    expect(r.q2).toBe(12);
    expect(r.sprint).toBe(12);
    expect(r.mainRace).toBe(25);
    expect(r.bonuses).toEqual([
      { code: "pole", points: 2 },
      { code: "winner", points: 5 },
    ]);
    expect(r.total).toBe(12 + 12 + 25 + 2 + 5);
  });

  it("el desglose suma al total", () => {
    const w: RiderWeekend = {
      q2: finished(3, { bonuses: [] }),
      sprint: finished(2, { penalties: ["time-penalty"] }),
      race: dnf(),
    };
    const r = scoreRiderWeekend("R", w, rules, emptyCtx);
    const bonusSum = r.bonuses.reduce((s, b) => s + b.points, 0);
    const penaltySum = r.penalties.reduce((s, p) => s + p.points, 0);
    expect(r.total).toBe(r.q2 + r.sprint + r.mainRace + bonusSum + penaltySum);
  });
});

describe("lineupWeekendPoints — combinación con pesos (scoring.md §4)", () => {
  const lineup: Lineup = {
    gold: ["A", "C"],
    silver: ["E", "H"],
    constructor: "X",
    team: "X-team",
  };
  const riderPoints = new Map([["A", 56], ["C", 32], ["E", 17], ["H", -4]]);
  const ctorPoints = new Map([["X", 38]]);
  const teamPoints = new Map([["X-team", 38]]);

  it("ejemplo scoring.md §5 → 170.5 (pesos oro 1.0 / plata 0.5)", () => {
    const total = lineupWeekendPoints(lineup, riderPoints, ctorPoints, teamPoints, {
      gold: rules.goldWeight,
      silver: rules.silverWeight,
    });
    expect(total).toBeCloseTo(170.5, 6);
  });

  it("usa los pesos de las reglas (no hardcodea)", () => {
    // Peso de plata 1.0 → E y H cuentan al 100%.
    const total = lineupWeekendPoints(lineup, riderPoints, ctorPoints, teamPoints, {
      gold: 1,
      silver: 1,
    });
    // oro: 56+32 = 88; plata: 17−4 = 13; ctor 38; team 38 → 177.
    expect(total).toBeCloseTo(88 + 13 + 38 + 38, 6);
  });

  it("piloto sin puntos → 0 (no falla)", () => {
    const empty = new Map<string, number>();
    const total = lineupWeekendPoints(lineup, empty, new Map(), new Map(), {
      gold: 1,
      silver: 0.5,
    });
    expect(total).toBe(0);
  });
});

describe("cheapestInTeam", () => {
  it("true si es el más barato del equipo", () => {
    const teamOf = new Map([["R", "T1"], ["O", "T1"]]);
    const priceOf = new Map([["R", 10], ["O", 20]]);
    expect(cheapestInTeam("R", teamOf, priceOf)).toBe(true);
  });

  it("true en empate de precio (ambos son el más barato)", () => {
    const teamOf = new Map([["R", "T1"], ["O", "T1"]]);
    const priceOf = new Map([["R", 10], ["O", 10]]);
    expect(cheapestInTeam("R", teamOf, priceOf)).toBe(true);
  });

  it("false si no es el más barato", () => {
    const teamOf = new Map([["R", "T1"], ["O", "T1"]]);
    const priceOf = new Map([["R", 20], ["O", 10]]);
    expect(cheapestInTeam("R", teamOf, priceOf)).toBe(false);
  });

  it("false si no tiene equipo", () => {
    const teamOf = new Map([["O", "T1"]]);
    const priceOf = new Map([["R", 10], ["O", 20]]);
    expect(cheapestInTeam("R", teamOf, priceOf)).toBe(false);
  });

  it("false si falta el precio del piloto", () => {
    const teamOf = new Map([["R", "T1"], ["O", "T1"]]);
    const priceOf = new Map([["O", 20]]);
    expect(cheapestInTeam("R", teamOf, priceOf)).toBe(false);
  });
});
