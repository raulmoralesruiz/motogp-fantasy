/**
 * Tests de los códigos importables por tipo de evento — núcleo puro,
 * ADR-0018.
 */
import { describe, expect, it } from "vitest";

import {
  BONUS_CODES_BY_EVENT,
  PENALTY_CODES_BY_EVENT,
  resultEventLabel,
  validateEntryForEvent,
} from "../codes.js";
import type { ResultValues } from "../types.js";

const baseEntry: ResultValues = {
  position: 1,
  started: true,
  finished: true,
  penalties: [],
  bonuses: [],
  rawPoints: null,
};

describe("mapas de códigos por evento (ADR-0018)", () => {
  it("q2: bono pole; penalización dq", () => {
    expect(BONUS_CODES_BY_EVENT.q2).toEqual(["pole"]);
    expect(PENALTY_CODES_BY_EVENT.q2).toEqual(["dq"]);
  });

  it("sprint: sin bonos; penalizaciones dq + time-penalty", () => {
    expect(BONUS_CODES_BY_EVENT.sprint).toEqual([]);
    expect(PENALTY_CODES_BY_EVENT.sprint).toEqual(["dq", "time-penalty"]);
  });

  it("race: bono fastest-lap; penalizaciones dq + time-penalty", () => {
    expect(BONUS_CODES_BY_EVENT.race).toEqual(["fastest-lap"]);
    expect(PENALTY_CODES_BY_EVENT.race).toEqual(["dq", "time-penalty"]);
  });
});

describe("resultEventLabel — etiquetas en español", () => {
  it("q2 → «Q2», sprint → «sprint», race → «carrera principal»", () => {
    expect(resultEventLabel("q2")).toBe("Q2");
    expect(resultEventLabel("sprint")).toBe("sprint");
    expect(resultEventLabel("race")).toBe("carrera principal");
  });
});

describe("validateEntryForEvent — validación semántica por evento", () => {
  it("entrada sin códigos → sin errores en cualquier evento", () => {
    expect(validateEntryForEvent(baseEntry, "q2")).toEqual([]);
    expect(validateEntryForEvent(baseEntry, "sprint")).toEqual([]);
    expect(validateEntryForEvent(baseEntry, "race")).toEqual([]);
  });

  it("pole en q2 con posición → sin errores", () => {
    const entry: ResultValues = { ...baseEntry, position: 1, bonuses: ["pole"] };
    expect(validateEntryForEvent(entry, "q2")).toEqual([]);
  });

  it("pole en q2 sin posición → error", () => {
    const entry: ResultValues = { ...baseEntry, position: null, started: false, finished: false, bonuses: ["pole"] };
    const errors = validateEntryForEvent(entry, "q2");
    expect(errors).toEqual(["El bono de pole exige que el piloto haya clasificado (posición en Q2)"]);
  });

  it("fastest-lap en race terminado → sin errores", () => {
    const entry: ResultValues = { ...baseEntry, bonuses: ["fastest-lap"] };
    expect(validateEntryForEvent(entry, "race")).toEqual([]);
  });

  it("fastest-lap en race sin terminar → error", () => {
    const entry: ResultValues = { ...baseEntry, position: null, finished: false, bonuses: ["fastest-lap"] };
    const errors = validateEntryForEvent(entry, "race");
    expect(errors).toEqual(["El bono de vuelta rápida exige que el piloto haya terminado la carrera"]);
  });

  it("pole en race → no aplicable", () => {
    const entry: ResultValues = { ...baseEntry, bonuses: ["pole"] };
    const errors = validateEntryForEvent(entry, "race");
    expect(errors).toEqual(["El bono «pole» no es válido en carrera principal"]);
  });

  it("fastest-lap en q2 → no aplicable", () => {
    const entry: ResultValues = { ...baseEntry, bonuses: ["fastest-lap"] };
    const errors = validateEntryForEvent(entry, "q2");
    expect(errors).toEqual(["El bono «fastest-lap» no es válido en Q2"]);
  });

  it("fastest-lap en sprint → no aplicable", () => {
    const entry: ResultValues = { ...baseEntry, bonuses: ["fastest-lap"] };
    const errors = validateEntryForEvent(entry, "sprint");
    expect(errors).toEqual(["El bono «fastest-lap» no es válido en sprint"]);
  });

  it("time-penalty en q2 → no aplicable", () => {
    const entry: ResultValues = { ...baseEntry, penalties: ["time-penalty"] };
    const errors = validateEntryForEvent(entry, "q2");
    expect(errors).toEqual(["La penalización «time-penalty» no es válida en Q2"]);
  });

  it("dq en sprint → sin errores", () => {
    const entry: ResultValues = { ...baseEntry, penalties: ["dq"] };
    expect(validateEntryForEvent(entry, "sprint")).toEqual([]);
  });

  it("time-penalty en race → sin errores", () => {
    const entry: ResultValues = { ...baseEntry, penalties: ["time-penalty"] };
    expect(validateEntryForEvent(entry, "race")).toEqual([]);
  });

  it("reporta todos los errores a la vez", () => {
    // En Q2: fastest-lap no es aplicable (y el piloto no terminó);
    // time-penalty no es aplicable.
    const entry: ResultValues = {
      ...baseEntry,
      finished: false,
      bonuses: ["fastest-lap"],
      penalties: ["time-penalty"],
    };
    const errors = validateEntryForEvent(entry, "q2");
    expect(errors).toEqual([
      "El bono «fastest-lap» no es válido en Q2",
      "La penalización «time-penalty» no es válida en Q2",
      "El bono de vuelta rápida exige que el piloto haya terminado la carrera",
    ]);
  });
});
