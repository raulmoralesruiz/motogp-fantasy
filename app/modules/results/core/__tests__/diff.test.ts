/**
 * Tests de la diferencia mínima entre re-importaciones — núcleo puro,
 * ADR-0018.
 */
import { describe, expect, it } from "vitest";

import { diffResults, sameResultValues } from "../diff.js";
import type { ResultEntry, ResultValues } from "../types.js";

const r1: ResultValues = {
  position: 1,
  started: true,
  finished: true,
  penalties: [],
  bonuses: [],
  rawPoints: null,
};

const entry = (riderId: string, values: Partial<ResultValues> = {}): ResultEntry => ({
  riderId,
  position: 1,
  started: true,
  finished: true,
  penalties: [],
  bonuses: [],
  rawPoints: null,
  ...values,
});

describe("sameResultValues — comparación de valores", () => {
  it("valores idénticos → true", () => {
    expect(sameResultValues(r1, { ...r1 })).toBe(true);
  });

  it("posición distinta → false", () => {
    expect(sameResultValues(r1, { ...r1, position: 2 })).toBe(false);
  });

  it("started distinto → false", () => {
    expect(sameResultValues(r1, { ...r1, started: false, position: null })).toBe(false);
  });

  it("finished distinto → false", () => {
    expect(sameResultValues(r1, { ...r1, finished: false, position: null })).toBe(false);
  });

  it("rawPoints distinto → false", () => {
    expect(sameResultValues(r1, { ...r1, rawPoints: 25 })).toBe(false);
  });

  it("mismos códigos en distinto orden → true (comparación por conjunto)", () => {
    const a: ResultValues = { ...r1, penalties: ["dq", "time-penalty"], bonuses: ["fastest-lap"] };
    const b: ResultValues = { ...r1, penalties: ["time-penalty", "dq"], bonuses: ["fastest-lap"] };
    expect(sameResultValues(a, b)).toBe(true);
  });

  it("códigos distintos → false", () => {
    const a: ResultValues = { ...r1, bonuses: ["fastest-lap"] };
    const b: ResultValues = { ...r1, bonuses: [] };
    expect(sameResultValues(a, b)).toBe(false);
  });
});

describe("diffResults — diferencia mínima (ADR-0018)", () => {
  it("BD vacía → todo se crea", () => {
    const incoming = [entry("r1"), entry("r2")];
    const diff = diffResults([], incoming);
    expect(diff.created).toEqual(incoming);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
    expect(diff.kept).toEqual([]);
  });

  it("payload vacío → todo se conserva (no se borra nada)", () => {
    const existing = [entry("r1"), entry("r2")];
    const diff = diffResults(existing, []);
    expect(diff.created).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
    expect(diff.kept).toEqual(["r1", "r2"]);
  });

  it("valores idénticos → unchanged (no-op: sin escritura ni auditoría)", () => {
    const existing = [entry("r1")];
    const diff = diffResults(existing, [entry("r1")]);
    expect(diff.created).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual(["r1"]);
    expect(diff.kept).toEqual([]);
  });

  it("valores distintos → changed con before/after", () => {
    const existing = [entry("r1", { position: 1 })];
    const incoming = [entry("r1", { position: 2 })];
    const diff = diffResults(existing, incoming);
    expect(diff.changed).toEqual([
      {
        riderId: "r1",
        before: { ...r1, position: 1 },
        after: { ...r1, position: 2 },
      },
    ]);
    expect(diff.created).toEqual([]);
    expect(diff.unchanged).toEqual([]);
    expect(diff.kept).toEqual([]);
  });

  it("códigos en distinto orden → unchanged (no es corrección)", () => {
    const existing = [entry("r1", { penalties: ["dq", "time-penalty"] })];
    const incoming = [entry("r1", { penalties: ["time-penalty", "dq"] })];
    const diff = diffResults(existing, incoming);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual(["r1"]);
  });

  it("pilotos ausentes del payload → kept (se conservan, nunca se borran)", () => {
    const existing = [entry("r1"), entry("r2"), entry("r3")];
    const incoming = [entry("r1"), entry("r2", { position: 2 })];
    const diff = diffResults(existing, incoming);
    expect(diff.created).toEqual([]);
    expect(diff.unchanged).toEqual(["r1"]);
    expect(diff.kept).toEqual(["r3"]);
    expect(diff.changed.map((c) => c.riderId)).toEqual(["r2"]);
  });

  it("diferencia mixta: crear + cambiar + conservar + no tocar", () => {
    const existing = [
      entry("r1", { position: 1 }),
      entry("r2", { position: 2 }),
      entry("r3", { position: 3 }),
    ];
    const incoming = [
      entry("r1", { position: 1 }), // unchanged
      entry("r2", { position: 5 }), // changed
      entry("r4", { position: 1 }), // created
    ];
    const diff = diffResults(existing, incoming);
    expect(diff.unchanged).toEqual(["r1"]);
    expect(diff.changed.map((c) => c.riderId)).toEqual(["r2"]);
    expect(diff.created.map((e) => e.riderId)).toEqual(["r4"]);
    expect(diff.kept).toEqual(["r3"]);
  });

  it("orden determinista: payload para created/changed/unchanged, BD para kept", () => {
    const existing = [entry("r3"), entry("r1")];
    const incoming = [entry("r1"), entry("r3", { position: 9 })];
    const diff = diffResults(existing, incoming);
    expect(diff.unchanged).toEqual(["r1"]);
    expect(diff.changed.map((c) => c.riderId)).toEqual(["r3"]);
    expect(diff.kept).toEqual([]);
  });
});
