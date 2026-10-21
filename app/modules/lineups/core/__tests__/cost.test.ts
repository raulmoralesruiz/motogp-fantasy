/**
 * Tests de coste del lineup con precios congelados del GP — núcleo puro,
 * ADR-0015/ADR-0017.
 */
import { describe, expect, it } from "vitest";

import { lineupCost } from "../cost.js";
import type { GpPrice, LineupSlots } from "../types.js";

const slots: LineupSlots = {
  gold: ["r1", "r6"],
  silver: ["r4", "r8"],
  constructorId: "c1",
  teamId: "t3",
};

const prices: GpPrice[] = [
  { assetType: "rider", assetId: "r1", price: 20 },
  { assetType: "rider", assetId: "r6", price: 15 },
  { assetType: "rider", assetId: "r4", price: 12.5 },
  { assetType: "rider", assetId: "r8", price: 10 },
  { assetType: "constructor", assetId: "c1", price: 18 },
  { assetType: "team", assetId: "t3", price: 16 },
];

describe("lineupCost", () => {
  it("suma los 6 activos con sus precios del GP", () => {
    const r = lineupCost(slots, prices);
    expect(r).toEqual({ ok: true, cost: 91.5 });
  });

  it("activo sin precio para el GP → rechazado con el activo faltante", () => {
    const sinR6 = prices.filter((p) => p.assetId !== "r6");
    const r = lineupCost(slots, sinR6);
    expect(r).toEqual({
      ok: false,
      missing: [{ assetType: "rider", assetId: "r6" }],
    });
  });

  it("constructor y equipo sin precio → ambos en la lista de faltantes", () => {
    const soloRiders = prices.filter((p) => p.assetType === "rider");
    const r = lineupCost(slots, soloRiders);
    expect(r).toEqual({
      ok: false,
      missing: [
        { assetType: "constructor", assetId: "c1" },
        { assetType: "team", assetId: "t3" },
      ],
    });
  });

  it("redondea al céntimo (deriva de punto flotante)", () => {
    const preciosRuidosos: GpPrice[] = [
      { assetType: "rider", assetId: "r1", price: 10.1 },
      { assetType: "rider", assetId: "r6", price: 10.2 },
      { assetType: "rider", assetId: "r4", price: 10.3 },
      { assetType: "rider", assetId: "r8", price: 10.4 },
      { assetType: "constructor", assetId: "c1", price: 10.5 },
      { assetType: "team", assetId: "t3", price: 10.6 },
    ];
    const r = lineupCost(slots, preciosRuidosos);
    expect(r).toEqual({ ok: true, cost: 62.1 });
  });

  it("slots vacíos y lista de precios vacía → coste 0 (caso degenerado)", () => {
    const vacio: LineupSlots = {
      gold: [],
      silver: [],
      constructorId: null,
      teamId: null,
    };
    expect(lineupCost(vacio, [])).toEqual({ ok: true, cost: 0 });
  });
});
