/**
 * Tests de la diferencia mínima entre composiciones — núcleo puro, ADR-0017.
 */
import { describe, expect, it } from "vitest";

import { diffSlots } from "../diff.js";
import type { LineupSlots } from "../types.js";

const base: LineupSlots = {
  gold: ["r1", "r2"],
  silver: ["r3", "r4"],
  constructorId: "c1",
  teamId: "t1",
};

describe("diffSlots — diferencia mínima entre composiciones", () => {
  it("misma composición → sin cambios", () => {
    expect(diffSlots(base, base)).toEqual([]);
  });

  it("reasignación oro↔plata con el mismo conjunto de pilotos → solo entradas gold_silver (US-11)", () => {
    const next: LineupSlots = {
      gold: ["r3", "r4"],
      silver: ["r1", "r2"],
      constructorId: "c1",
      teamId: "t1",
    };
    // Los 4 pilotos cambian de tier: una gold_silver por piloto, orden por ID.
    expect(diffSlots(base, next)).toEqual([
      { type: "gold_silver", assetType: "rider", assetId: "r1" },
      { type: "gold_silver", assetType: "rider", assetId: "r2" },
      { type: "gold_silver", assetType: "rider", assetId: "r3" },
      { type: "gold_silver", assetType: "rider", assetId: "r4" },
    ]);
  });

  it("reasignación parcial (2 de 4) → 2 entradas gold_silver, sin swaps", () => {
    // r2 pasa oro→plata y r3 plata→oro; r1 y r4 mantienen su tier.
    const next: LineupSlots = {
      gold: ["r1", "r3"],
      silver: ["r2", "r4"],
      constructorId: "c1",
      teamId: "t1",
    };
    expect(diffSlots(base, next)).toEqual([
      { type: "gold_silver", assetType: "rider", assetId: "r2" },
      { type: "gold_silver", assetType: "rider", assetId: "r3" },
    ]);
  });

  it("swap + reasignación mixtos → swap primero, luego gold_silver", () => {
    // r4 sale y r5 entra (swap); r2 pasa oro→plata (gold_silver).
    const next: LineupSlots = {
      gold: ["r1", "r5"],
      silver: ["r3", "r2"],
      constructorId: "c1",
      teamId: "t1",
    };
    expect(diffSlots(base, next)).toEqual([
      { type: "swap", assetType: "rider", assetId: "r5" },
      { type: "gold_silver", assetType: "rider", assetId: "r2" },
    ]);
  });

  it("gold_silver orden determinista por ID con IDs desordenados", () => {
    const old: LineupSlots = {
      gold: ["rb", "ra"],
      silver: ["rc", "rd"],
      constructorId: "c1",
      teamId: "t1",
    };
    const next: LineupSlots = {
      gold: ["rc", "rb"],
      silver: ["ra", "rd"],
      constructorId: "c1",
      teamId: "t1",
    };
    // ra pasa oro→plata y rc plata→oro; rb y rd mantienen su tier.
    expect(diffSlots(old, next)).toEqual([
      { type: "gold_silver", assetType: "rider", assetId: "ra" },
      { type: "gold_silver", assetType: "rider", assetId: "rc" },
    ]);
  });

  it("1 swap de pilotos → 1 cambio (assetId = el piloto añadido)", () => {
    const next: LineupSlots = {
      ...base,
      silver: ["r3", "r5"],
    };
    expect(diffSlots(base, next)).toEqual([
      { type: "swap", assetType: "rider", assetId: "r5" },
    ]);
  });

  it("2 swaps de pilotos → 2 cambios emparejados por orden de ID", () => {
    const next: LineupSlots = {
      gold: ["r5", "r2"],
      silver: ["r3", "r6"],
      constructorId: "c1",
      teamId: "t1",
    };
    expect(diffSlots(base, next)).toEqual([
      { type: "swap", assetType: "rider", assetId: "r5" },
      { type: "swap", assetType: "rider", assetId: "r6" },
    ]);
  });

  it("bajas < altas: swaps emparejados + add sobrante (2 swaps + 1 add)", () => {
    // Composición siguiente mayor (fórmula general; con composición
    // válida 2+2+1+1 los conjuntos siempre empatan): removed = [r1, r2],
    // added = [r5, r6, r7] → 2 swaps + 1 add.
    const next: LineupSlots = {
      gold: ["r5", "r6"],
      silver: ["r3", "r4", "r7"],
      constructorId: "c1",
      teamId: "t1",
    };
    expect(diffSlots(base, next)).toEqual([
      { type: "swap", assetType: "rider", assetId: "r5" },
      { type: "swap", assetType: "rider", assetId: "r6" },
      { type: "add", assetType: "rider", assetId: "r7" },
    ]);
  });

  it("sobrante sin emparejar → remove (1 swap + 1 remove + gold_silver)", () => {
    // Composición siguiente menor (fórmula general; con composición
    // válida 2+2+1+1 los conjuntos siempre empatan): removed = [r1, r2],
    // added = [r5] → swap(r5) + remove(r2); además r3 pasa plata→oro
    // (gold_silver).
    const old: LineupSlots = {
      gold: ["r1", "r2"],
      silver: ["r3", "r4"],
      constructorId: "c1",
      teamId: "t1",
    };
    const next: LineupSlots = {
      gold: ["r5", "r3"],
      silver: ["r4"],
      constructorId: "c1",
      teamId: "t1",
    };
    expect(diffSlots(old, next)).toEqual([
      { type: "swap", assetType: "rider", assetId: "r5" },
      { type: "remove", assetType: "rider", assetId: "r2" },
      { type: "gold_silver", assetType: "rider", assetId: "r3" },
    ]);
  });

  it("cambio de constructor → 1 swap (assetType constructor)", () => {
    const next: LineupSlots = { ...base, constructorId: "c2" };
    expect(diffSlots(base, next)).toEqual([
      { type: "swap", assetType: "constructor", assetId: "c2" },
    ]);
  });

  it("cambio de equipo → 1 swap (assetType team)", () => {
    const next: LineupSlots = { ...base, teamId: "t2" };
    expect(diffSlots(base, next)).toEqual([
      { type: "swap", assetType: "team", assetId: "t2" },
    ]);
  });

  it("swap de piloto + constructor + equipo → 3 cambios (pilotos primero)", () => {
    const next: LineupSlots = {
      gold: ["r5", "r2"],
      silver: ["r3", "r4"],
      constructorId: "c2",
      teamId: "t2",
    };
    expect(diffSlots(base, next)).toEqual([
      { type: "swap", assetType: "rider", assetId: "r5" },
      { type: "swap", assetType: "constructor", assetId: "c2" },
      { type: "swap", assetType: "team", assetId: "t2" },
    ]);
  });

  it("emparejado determinista con IDs desordenados (orden alfabético)", () => {
    const old: LineupSlots = {
      gold: ["rb", "ra"],
      silver: ["rc", "rd"],
      constructorId: "c1",
      teamId: "t1",
    };
    const next: LineupSlots = {
      gold: ["re", "ra"],
      silver: ["rc", "rf"],
      constructorId: "c1",
      teamId: "t1",
    };
    // removed = [rb, rd] → added = [re, rf]: swap(re), swap(rf).
    expect(diffSlots(old, next)).toEqual([
      { type: "swap", assetType: "rider", assetId: "re" },
      { type: "swap", assetType: "rider", assetId: "rf" },
    ]);
  });
});
