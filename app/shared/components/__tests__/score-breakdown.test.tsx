// @vitest-environment jsdom
/**
 * Tests de `app/shared/components/score-breakdown.tsx` (US-20, reutilizado
 * por US-22): el desglose de la puntuación de un lineup (oro/plata con
 * pesos, desglose por piloto Q2/sprint/carrera/bonos/penalizaciones,
 * constructor y equipo).
 *
 * El fixture replica el ejemplo de `docs/product/scoring.md` §5 (170.5
 * puntos), el mismo que cubren los tests de integración y de `/puntuacion`.
 */
import type { MyScoreView } from "@/modules/results";
import { describe, expect, it } from "vitest";

import { render, screen } from "../../../../test/rtl";
import { ScoreBreakdown, fmt } from "../score-breakdown";

const SCORE: MyScoreView = {
  gpId: "gp-1",
  gpName: "GP de Jerez",
  round: 1,
  seasonName: "Temporada 2099",
  pointsTotal: 170.5,
  rulesVersion: "scoring-v1",
  resultsVersion: "rv-1",
  computedAt: new Date("2026-10-24T10:00:00Z"),
  gold: [
    {
      riderId: "r1",
      riderName: "Piloto A",
      weight: 1.0,
      points: 56,
      breakdown: {
        q2: 12,
        sprint: 12,
        mainRace: 25,
        bonuses: [
          { code: "pole", points: 2 },
          { code: "winner", points: 5 },
        ],
        penalties: [],
        total: 56,
      },
    },
    {
      riderId: "r3",
      riderName: "Piloto C",
      weight: 1.0,
      points: 32,
      breakdown: {
        q2: 8,
        sprint: 3,
        mainRace: 20,
        bonuses: [{ code: "positions-gained", points: 1 }],
        penalties: [],
        total: 32,
      },
    },
  ],
  silver: [
    {
      riderId: "r4",
      riderName: "Piloto E",
      weight: 0.5,
      points: 8.5,
      breakdown: { q2: 5, sprint: 2, mainRace: 10, bonuses: [], penalties: [], total: 17 },
    },
    {
      riderId: "r5",
      riderName: "Piloto H",
      weight: 0.5,
      points: -2,
      breakdown: {
        q2: 1,
        sprint: 0,
        mainRace: 0,
        bonuses: [],
        penalties: [{ code: "dnf", points: -5 }],
        total: -4,
      },
    },
  ],
  constructor: { id: "ctor-x", name: "Constructor X", points: 38 },
  team: { id: "team-x", name: "Equipo X", points: 38 },
  total: 170.5,
};

describe("ScoreBreakdown", () => {
  it("muestra oro/plata con pesos y desglose por piloto", () => {
    render(<ScoreBreakdown score={SCORE} />);

    // Secciones.
    expect(screen.getByRole("heading", { level: 3, name: "Oro" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Plata" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Constructor y equipo" }),
    ).toBeInTheDocument();

    // Pesos oro/plata (2 oro ×1, 2 plata ×0,5).
    expect(screen.getAllByText("(peso ×1)")).toHaveLength(2);
    expect(screen.getAllByText("(peso ×0,5)")).toHaveLength(2);

    // Pilotos por nombre + puntos ponderados.
    expect(screen.getByText("Piloto A")).toBeInTheDocument();
    expect(screen.getByText("56 pts")).toBeInTheDocument();
    expect(screen.getByText("Piloto C")).toBeInTheDocument();
    expect(screen.getByText("32 pts")).toBeInTheDocument();
    expect(screen.getByText("Piloto E")).toBeInTheDocument();
    expect(screen.getByText("8,5 pts")).toBeInTheDocument();
    expect(screen.getByText("Piloto H")).toBeInTheDocument();
    expect(screen.getByText("-2 pts")).toBeInTheDocument();

    // Desglose de A: Q2/sprint/carrera + bonos (pole, ganador).
    expect(screen.getByText("Q2: 12")).toBeInTheDocument();
    expect(screen.getByText("Sprint: 12")).toBeInTheDocument();
    expect(screen.getByText("Carrera: 25")).toBeInTheDocument();
    expect(screen.getByText(/Pole \(\+2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ganador \(\+5\)/)).toBeInTheDocument();

    // Desglose de H: penalización DNF.
    expect(screen.getByText(/DNF \(-5\)/)).toBeInTheDocument();
  });

  it("muestra constructor y equipo con sus puntos", () => {
    render(<ScoreBreakdown score={SCORE} />);

    expect(screen.getByText("Constructor X")).toBeInTheDocument();
    expect(screen.getByText("Equipo X")).toBeInTheDocument();
    expect(screen.getAllByText("38 pts")).toHaveLength(2);
  });

  it("fmt formatea en es-ES (coma decimal, sin ceros sobrantes)", () => {
    expect(fmt(170.5)).toBe("170,5");
    expect(fmt(38)).toBe("38");
    expect(fmt(0.5)).toBe("0,5");
    expect(fmt(-2)).toBe("-2");
  });
});
