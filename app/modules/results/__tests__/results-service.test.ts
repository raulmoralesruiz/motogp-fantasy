/**
 * Tests de ramas defensivas de `ResultsService` (ADR-0031) que la suite de
 * integración no recorre: la validación de composición 2+2+1+1 de
 * `lineupScoreView` (invariante 1). En BD la composición está garantizada por
 * constraint, así que la rama solo se cubre llamando al método privado con un
 * lineup incompleto (lanza antes de cualquier I/O).
 *
 * `prisma` se inyecta como objeto falso (el método lanza antes de usarlo).
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ResultsService } from "../results-service";

type Slot = { slotType: string; assetType: string; assetId: string };

/** Accede al método privado `lineupScoreView` (lanza antes de usar `this`). */
function lineupScoreViewOf(service: ResultsService) {
  return (
    service as unknown as {
      lineupScoreView: (
        slots: Slot[],
        riderPoints: Map<string, number>,
        riderBreakdowns: Map<string, unknown>,
        ctorPoints: Map<string, number>,
        teamPoints: Map<string, number>,
        weights: { gold: number; silver: number },
      ) => Promise<unknown>;
    }
  ).lineupScoreView.bind(service);
}

describe("ResultsService.lineupScoreView (ADR-0031, invariante 1)", () => {
  it("composición inválida (no 2+2+1+1) → INTERNAL_SERVER_ERROR", async () => {
    const service = new ResultsService({ prisma: {} as unknown as PrismaClient });
    const lineupScoreView = lineupScoreViewOf(service);

    // Lineup incompleto: sin oro, plata, constructor ni equipo.
    await expect(
      lineupScoreView(
        [],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        { gold: 1, silver: 0.5 },
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "El lineup no tiene la composición 2+2+1+1 (invariante 1).",
    });
  });

  it("falta el constructor (2+2+0+1) → INTERNAL_SERVER_ERROR", async () => {
    const service = new ResultsService({ prisma: {} as unknown as PrismaClient });
    const lineupScoreView = lineupScoreViewOf(service);

    const slots: Slot[] = [
      { slotType: "gold", assetType: "rider", assetId: "r1" },
      { slotType: "gold", assetType: "rider", assetId: "r2" },
      { slotType: "silver", assetType: "rider", assetId: "r3" },
      { slotType: "silver", assetType: "rider", assetId: "r4" },
      { slotType: "team", assetType: "team", assetId: "t1" },
    ];
    await expect(
      lineupScoreView(
        slots,
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        { gold: 1, silver: 0.5 },
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
