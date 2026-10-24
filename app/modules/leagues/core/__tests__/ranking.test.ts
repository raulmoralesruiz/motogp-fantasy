/**
 * Tests de ranking y desempates de liga — núcleo puro (US-21, leagues.md §8).
 *
 * CA: "desempates en el orden de `leagues.md` §8 (más GPs ganados → mejor
 * último GP → menor coste total → antigüedad) (test de unit de desempates)".
 */
import { describe, expect, it } from "vitest";

import { sortRanking, type RankingInput } from "../ranking.js";

/** Entrada base (todos los desempates neutros) para sobreescribir por caso. */
function input(overrides: Partial<RankingInput> & { userId: string }): RankingInput {
  return {
    points: 0,
    gpsWon: 0,
    lastGpScore: 0,
    totalCost: 0,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const ids = (list: readonly RankingInput[]): string[] => list.map((r) => r.userId);

describe("sortRanking (leagues.md §8)", () => {
  it("ordena por puntos (desc) como clave principal", () => {
    const r = sortRanking([
      input({ userId: "a", points: 100 }),
      input({ userId: "b", points: 300 }),
      input({ userId: "c", points: 200 }),
    ]);
    expect(ids(r)).toEqual(["b", "c", "a"]);
  });

  it("empate en puntos → más GPs ganados (desc)", () => {
    const r = sortRanking([
      input({ userId: "a", points: 200, gpsWon: 1 }),
      input({ userId: "b", points: 200, gpsWon: 3 }),
      input({ userId: "c", points: 200, gpsWon: 2 }),
    ]);
    expect(ids(r)).toEqual(["b", "c", "a"]);
  });

  it("empate en puntos y GPs ganados → mejor último GP (desc)", () => {
    const r = sortRanking([
      input({ userId: "a", points: 200, gpsWon: 2, lastGpScore: 10 }),
      input({ userId: "b", points: 200, gpsWon: 2, lastGpScore: 40 }),
      input({ userId: "c", points: 200, gpsWon: 2, lastGpScore: 25 }),
    ]);
    expect(ids(r)).toEqual(["b", "c", "a"]);
  });

  it("empate en puntos, GPs ganados y último GP → menor coste total (asc)", () => {
    const r = sortRanking([
      input({ userId: "a", points: 200, gpsWon: 2, lastGpScore: 30, totalCost: 300 }),
      input({ userId: "b", points: 200, gpsWon: 2, lastGpScore: 30, totalCost: 100 }),
      input({ userId: "c", points: 200, gpsWon: 2, lastGpScore: 30, totalCost: 200 }),
    ]);
    expect(ids(r)).toEqual(["b", "c", "a"]);
  });

  it("empate en todo lo anterior → antigüedad (asc, quien se unió antes)", () => {
    const r = sortRanking([
      input({ userId: "a", joinedAt: new Date("2026-03-01T00:00:00Z") }),
      input({ userId: "b", joinedAt: new Date("2026-01-01T00:00:00Z") }),
      input({ userId: "c", joinedAt: new Date("2026-02-01T00:00:00Z") }),
    ]);
    expect(ids(r)).toEqual(["b", "c", "a"]);
  });

  it("cascada completa: aplica los desempates en el orden de leagues.md §8", () => {
    // Todos empatan en puntos. b gana por GPs ganados; c y d empatan en
    // GPs ganados y c gana por último GP; d y e empatan hasta el coste;
    // e y f empatan hasta la antigüedad.
    const base = { points: 500 };
    const r = sortRanking([
      input({ userId: "a", ...base, gpsWon: 0, lastGpScore: 5, totalCost: 100, joinedAt: new Date("2026-01-01") }),
      input({ userId: "b", ...base, gpsWon: 4, lastGpScore: 5, totalCost: 400, joinedAt: new Date("2026-06-01") }),
      input({ userId: "c", ...base, gpsWon: 1, lastGpScore: 90, totalCost: 300, joinedAt: new Date("2026-05-01") }),
      input({ userId: "d", ...base, gpsWon: 1, lastGpScore: 90, totalCost: 150, joinedAt: new Date("2026-04-01") }),
      input({ userId: "e", ...base, gpsWon: 1, lastGpScore: 90, totalCost: 150, joinedAt: new Date("2026-03-01") }),
      input({ userId: "f", ...base, gpsWon: 1, lastGpScore: 90, totalCost: 150, joinedAt: new Date("2026-02-01") }),
    ]);
    // b (4 GPs ganados) primero; a (0 GPs) al final.
    // c/d/e/f empatan en GPs ganados (1) y último GP (90):
    //   d/e/f (coste 150) antes que c (coste 300);
    //   d/e/f empatan hasta antigüedad: f (feb) > e (mar) > d (abr).
    expect(ids(r)).toEqual(["b", "f", "e", "d", "c", "a"]);
  });

  it("no muta la lista de entrada (devuelve una copia ordenada)", () => {
    const original = [
      input({ userId: "a", points: 100 }),
      input({ userId: "b", points: 300 }),
    ];
    const copy = [...original];
    sortRanking(original);
    expect(ids(original)).toEqual(ids(copy)); // orden original intacto
  });

  it("lista vacía → vacía", () => {
    expect(sortRanking([])).toEqual([]);
  });

  it("una sola entrada → la misma", () => {
    expect(ids(sortRanking([input({ userId: "solo", points: 42 })]))).toEqual(["solo"]);
  });
});
