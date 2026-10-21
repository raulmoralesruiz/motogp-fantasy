/**
 * Tests de validación de lineup (composición, duplicados, afiliación,
 * concentración) — núcleo puro, ADR-0017.
 *
 * Fixture ficticio (sin PII):
 * - Constructor c1: equipo t1 (r1, r2, r3) y equipo t2 (r4, r5).
 * - Constructor c2: equipo t3 (r6, r7) y equipo t4 (r8, r9).
 */
import { describe, expect, it } from "vitest";

import { validateLineup } from "../validation.js";
import type { ConcentrationLimits } from "../types.js";

const affs = [
  { riderId: "r1", teamId: "t1", constructorId: "c1" },
  { riderId: "r2", teamId: "t1", constructorId: "c1" },
  { riderId: "r3", teamId: "t1", constructorId: "c1" },
  { riderId: "r4", teamId: "t2", constructorId: "c1" },
  { riderId: "r5", teamId: "t2", constructorId: "c1" },
  { riderId: "r6", teamId: "t3", constructorId: "c2" },
  { riderId: "r7", teamId: "t3", constructorId: "c2" },
  { riderId: "r8", teamId: "t4", constructorId: "c2" },
  { riderId: "r9", teamId: "t4", constructorId: "c2" },
];

/** Límites PROVISIONAL reales (season_rules.limits). */
const limitsReal: ConcentrationLimits = { maxPerConstructor: 2, maxPerTeam: 2 };
/** Límites permisivos para aislar los motivos de composición. */
const limitsLenient: ConcentrationLimits = { maxPerConstructor: 5, maxPerTeam: 3 };

const valid = {
  gold: ["r1", "r6"],
  silver: ["r4", "r8"],
  constructorId: "c1",
  teamId: "t3",
};

describe("validateLineup", () => {
  it("lineup válido (2+2+1+1, sin concentración) → ok", () => {
    expect(validateLineup(valid, affs, limitsReal)).toEqual({ ok: true });
  });

  it("3 oro → rechazado con motivo", () => {
    const r = validateLineup(
      { ...valid, gold: ["r1", "r6", "r5"] },
      affs,
      limitsLenient,
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.reasons).toEqual([
        "El lineup debe tener exactamente 2 pilotos oro (tiene 3)",
      ]);
    }
  });

  it("1 oro → rechazado con motivo", () => {
    const r = validateLineup({ ...valid, gold: ["r1"] }, affs, limitsLenient);
    if (!r.ok) {
      expect(r.reasons).toEqual([
        "El lineup debe tener exactamente 2 pilotos oro (tiene 1)",
      ]);
    }
  });

  it("3 plata → rechazado con motivo", () => {
    const r = validateLineup(
      { ...valid, silver: ["r4", "r8", "r7"] },
      affs,
      limitsLenient,
    );
    if (!r.ok) {
      expect(r.reasons).toEqual([
        "El lineup debe tener exactamente 2 pilotos plata (tiene 3)",
      ]);
    }
  });

  it("falta el constructor → rechazado con motivo", () => {
    const r = validateLineup(
      { ...valid, constructorId: null },
      affs,
      limitsLenient,
    );
    if (!r.ok) {
      expect(r.reasons).toEqual(["Falta el constructor del lineup"]);
    }
  });

  it("falta el equipo → rechazado con motivo", () => {
    const r = validateLineup({ ...valid, teamId: null }, affs, limitsLenient);
    if (!r.ok) {
      expect(r.reasons).toEqual(["Falta el equipo del lineup"]);
    }
  });

  it("piloto duplicado entre oro y plata → rechazado con motivo", () => {
    const r = validateLineup(
      { ...valid, silver: ["r1", "r8"] },
      affs,
      limitsLenient,
    );
    if (!r.ok) {
      expect(r.reasons).toEqual(["Piloto duplicado en el lineup: r1"]);
    }
  });

  it("piloto duplicado dentro de oro → rechazado con motivo", () => {
    const r = validateLineup(
      { ...valid, gold: ["r1", "r1"] },
      affs,
      limitsLenient,
    );
    if (!r.ok) {
      expect(r.reasons).toEqual(["Piloto duplicado en el lineup: r1"]);
    }
  });

  it("piloto sin afiliación para el GP → rechazado con motivo", () => {
    const r = validateLineup(
      { ...valid, gold: ["r1", "r99"] },
      affs,
      limitsLenient,
    );
    if (!r.ok) {
      expect(r.reasons).toEqual([
        "El piloto r99 no tiene afiliación para este GP",
      ]);
    }
  });

  it("concentración por constructor (3 de c1, máx 2) → rechazado", () => {
    const r = validateLineup(
      { ...valid, silver: ["r2", "r4"] },
      affs,
      limitsReal,
    );
    if (!r.ok) {
      expect(r.reasons).toEqual([
        "Concentración excedida: 3 pilotos del constructor c1 (máx 2)",
      ]);
    }
  });

  it("concentración por equipo (3 de t1, máx 2) → rechazado", () => {
    const r = validateLineup(
      { ...valid, gold: ["r1", "r2"], silver: ["r3", "r6"] },
      affs,
      { maxPerConstructor: 4, maxPerTeam: 2 },
    );
    if (!r.ok) {
      expect(r.reasons).toEqual([
        "Concentración excedida: 3 pilotos del equipo t1 (máx 2)",
      ]);
    }
  });

  it("concentración doble (constructor y equipo) → ambos motivos", () => {
    const r = validateLineup(
      { ...valid, gold: ["r1", "r2"], silver: ["r3", "r4"] },
      affs,
      limitsReal,
    );
    if (!r.ok) {
      expect(r.reasons).toEqual([
        "Concentración excedida: 4 pilotos del constructor c1 (máx 2)",
        "Concentración excedida: 3 pilotos del equipo t1 (máx 2)",
      ]);
    }
  });

  it("lineup vacío → los 4 motivos de composición", () => {
    const r = validateLineup(
      { gold: [], silver: [], constructorId: null, teamId: null },
      affs,
      limitsLenient,
    );
    if (!r.ok) {
      expect(r.reasons).toEqual([
        "El lineup debe tener exactamente 2 pilotos oro (tiene 0)",
        "El lineup debe tener exactamente 2 pilotos plata (tiene 0)",
        "Falta el constructor del lineup",
        "Falta el equipo del lineup",
      ]);
    }
  });
});
