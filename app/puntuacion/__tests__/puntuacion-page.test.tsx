// @vitest-environment jsdom
/**
 * Tests de `app/puntuacion/puntuacion-page.tsx` (US-20): selección de
 * temporada/GP y desglose de la puntuación (por piloto Q2/sprint/GP/bonos/
 * penal, constructor y equipo, con pesos oro/plata) sobre el `trpc` mockeado.
 *
 * El desglose replicado es el ejemplo de `docs/product/scoring.md` §5
 * (170.5 puntos), el mismo que cubre el test de integración.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import PuntuacionPage from "../puntuacion-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

const SEASON_ID = "season-2099";
const GP1 = { id: "gp-1", name: "GP de Jerez", round: 1 };

/** Desglose de 170.5 (scoring.md §5): oro {A,C}, plata {E,H}, ctor/equipo X. */
const SCORE = {
  gpId: GP1.id,
  gpName: GP1.name,
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

function renderPuntuacion(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockSeasons() {
  mockResult(trpc.seasons.list.useQuery, {
    data: [{ id: SEASON_ID, name: "Temporada 2099" }],
    isPending: false,
    isError: false,
  });
}

function mockGps() {
  mockResult(trpc.seasons.gps.list.useQuery, {
    data: [GP1],
    isPending: false,
    isError: false,
  });
}

/** Navega hasta el GP1 (temporada + GP). */
async function openGp1(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
  await user.selectOptions(screen.getByLabelText("GP"), GP1.id);
}

describe("PuntuacionPage", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  it("muestra el estado pendiente", () => {
    renderPuntuacion(<PuntuacionPage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra un error si la lista de temporadas falla", () => {
    mockResult(trpc.seasons.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderPuntuacion(<PuntuacionPage />);
    expect(
      screen.getByText("No se pudo cargar la lista de temporadas."),
    ).toBeInTheDocument();
  });

  it("muestra la selección de temporada y GP y pide un GP si no se elige", async () => {
    mockSeasons();
    mockGps();
    renderPuntuacion(<PuntuacionPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);

    expect(
      screen.getByText("Selecciona un GP para ver tu puntuación."),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "J1 · GP de Jerez" })).toBeInTheDocument();
  });

  it("muestra el desglose de la puntuación (170.5) al seleccionar el GP", async () => {
    mockSeasons();
    mockGps();
    mockResult(trpc.results.myScore.useQuery, {
      data: SCORE,
      isPending: false,
      isError: false,
    });
    renderPuntuacion(<PuntuacionPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // Total y encabezado.
    expect(screen.getByRole("heading", { level: 2, name: /Mi puntuación — GP de Jerez/ })).toBeInTheDocument();
    expect(screen.getByText("170,5 puntos")).toBeInTheDocument();
    expect(screen.getByText(/reglas scoring-v1/)).toBeInTheDocument();

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

    // Constructor y equipo: 38 pts.
    expect(screen.getByText("Constructor X")).toBeInTheDocument();
    expect(screen.getByText("Equipo X")).toBeInTheDocument();
    expect(screen.getAllByText("38 pts")).toHaveLength(2);
  });

  it("muestra el error si el GP no tiene resultados definitivos", async () => {
    mockSeasons();
    mockGps();
    mockResult(trpc.results.myScore.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error(
        "Este GP aún no tiene resultados definitivos; tu puntuación aparecerá cuando se marquen definitivos.",
      ),
    });
    renderPuntuacion(<PuntuacionPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByText(/Este GP aún no tiene resultados definitivos/),
    ).toBeInTheDocument();
    expect(screen.queryByText("170,5 puntos")).not.toBeInTheDocument();
  });

  it("muestra el error si no hay lineup en el GP", async () => {
    mockSeasons();
    mockGps();
    mockResult(trpc.results.myScore.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("No tienes lineup para este GP."),
    });
    renderPuntuacion(<PuntuacionPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(screen.getByText("No tienes lineup para este GP.")).toBeInTheDocument();
  });
});
