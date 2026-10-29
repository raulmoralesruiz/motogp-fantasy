// @vitest-environment jsdom
/**
 * Tests de `app/resultados/resultados-page.tsx` (US-22): selección de
 * temporada/GP y la vista de resultados (estado del GP, posición en cada
 * liga + delta vs el GP anterior, aviso + histórico de recálculo
 * anterior → nuevo, desglose US-20 y estado "GP cancelado, 0 puntos")
 * sobre el `trpc` mockeado.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import type { MyLeagueGpRanking, MyResultsView } from "@/server/routers/results";

import ResultadosPage from "../resultados-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

const SEASON_ID = "season-2099";
const GP1 = { id: "gp-1", name: "GP de Jerez", round: 1 };
const GP2 = { id: "gp-2", name: "GP de Le Mans", round: 2 };

/** Liga con posición en el GP + delta negativo (bajó 1) + general. */
const LEAGUE: MyLeagueGpRanking = {
  leagueId: "league-1",
  leagueName: "Liga A",
  gpPosition: 2,
  gpPoints: 120.5,
  overallPosition: 2,
  overallPoints: 240.5,
  delta: -1,
};

/** Vista `results.myResults` del GP2 (definitivo, rv-2, 1 corrección). */
const RESULTS: MyResultsView = {
  gp: {
    id: GP2.id,
    name: GP2.name,
    round: 2,
    seasonId: SEASON_ID,
    seasonName: "Temporada 2099",
    date: new Date("2099-06-07T12:00:00Z"),
    status: "finished",
    lockoutAt: null,
  },
  cancelled: false,
  state: {
    gpId: GP2.id,
    gpName: GP2.name,
    round: 2,
    seasonName: "Temporada 2099",
    definitive: true,
    resultsVersion: "rv-2",
    counts: { provisional: 0, definitive: 36, corrected: 0 },
    totalResults: 36,
    lineups: 12,
  },
  recalculation: {
    corrections: 1,
    lastAt: new Date("2026-10-25T10:00:00Z"),
    history: [
      {
        riderId: "r1",
        riderName: "Piloto A",
        eventLabel: "carrera",
        before: {
          position: 3,
          started: true,
          finished: true,
          penalties: [],
          bonuses: [],
          rawPoints: null,
        },
        after: {
          position: 5,
          started: true,
          finished: false,
          penalties: ["dnf"],
          bonuses: [],
          rawPoints: null,
        },
        reason: "Corrección oficial DNF",
        actor: "admin_a",
        at: new Date("2026-10-25T10:00:00Z"),
      },
    ],
  },
  previousGp: { id: GP1.id, name: GP1.name, round: 1 },
  leagues: [LEAGUE],
};

/** Desglose de 170.5 (scoring.md §5), el mismo fixture de `/puntuacion`. */
const SCORE = {
  gpId: GP2.id,
  gpName: GP2.name,
  round: 2,
  seasonName: "Temporada 2099",
  pointsTotal: 170.5,
  rulesVersion: "scoring-v1",
  resultsVersion: "rv-2",
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

function renderResultados(ui: ReactElement) {
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
    data: [GP1, GP2],
    isPending: false,
    isError: false,
  });
}

function mockResults(data: typeof RESULTS) {
  mockResult(trpc.results.myResults.useQuery, {
    data,
    isPending: false,
    isError: false,
  });
}

function mockScore(score: typeof SCORE) {
  mockResult(trpc.results.myScore.useQuery, {
    data: score,
    isPending: false,
    isError: false,
  });
}

/** Navega hasta el GP2 (temporada + GP). */
async function openGp2(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
  await user.selectOptions(screen.getByLabelText("GP"), GP2.id);
}

describe("ResultadosPage", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  it("muestra el estado pendiente", () => {
    renderResultados(<ResultadosPage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra un error si la lista de temporadas falla", () => {
    mockResult(trpc.seasons.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderResultados(<ResultadosPage />);
    expect(
      screen.getByText("No se pudo cargar la lista de temporadas."),
    ).toBeInTheDocument();
  });

  it("muestra la selección de temporada y GP y pide un GP si no se elige", async () => {
    mockSeasons();
    mockGps();
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);

    expect(
      screen.getByText("Selecciona un GP para ver tus resultados."),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "J2 · GP de Le Mans" })).toBeInTheDocument();
  });

  it("muestra estado, posición + delta, recálculo con histórico y desglose", async () => {
    mockSeasons();
    mockGps();
    mockResults(RESULTS);
    mockScore(SCORE);
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    // Estado del GP (definitivo + versión).
    expect(
      screen.getByRole("heading", { level: 2, name: "Mis resultados — GP de Le Mans" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Resultados definitivos")).toBeInTheDocument();
    expect(screen.getByText("(versión rv-2)")).toBeInTheDocument();

    // Posición en la liga + delta negativo (bajó 1) + general.
    expect(screen.getByText("Liga A")).toBeInTheDocument();
    expect(screen.getByText(/posición 2 \(120,5 pts\)/)).toBeInTheDocument();
    expect(screen.getByText("▼ 1 vs GP anterior")).toBeInTheDocument();
    expect(screen.getByText(/general: 2 \(240,5 pts\)/)).toBeInTheDocument();

    // Recálculo: aviso + histórico anterior → nuevo (motivo + actor).
    expect(
      screen.getByRole("heading", { level: 3, name: "Resultados actualizados" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 corrección/)).toBeInTheDocument();
    // Piloto A aparece en el histórico y en el desglose (oro).
    expect(screen.getAllByText("Piloto A")).toHaveLength(2);
    expect(
      screen.getByText(/\(carrera\): pos\. 3, terminó → pos\. 5, DNF/),
    ).toBeInTheDocument();
    expect(screen.getByText("— Corrección oficial DNF")).toBeInTheDocument();
    expect(screen.getByText("(por admin_a)")).toBeInTheDocument();

    // Desglose (US-20) con el total y los pilotos.
    expect(screen.getByText("170,5 puntos")).toBeInTheDocument();
    expect(screen.getByText("56 pts")).toBeInTheDocument();
    expect(screen.getByText("Constructor X")).toBeInTheDocument();
  });

  it("muestra 'GP cancelado, 0 puntos' cuando el GP está cancelado", async () => {
    mockSeasons();
    mockGps();
    mockResults({ ...RESULTS, cancelled: true, gp: { ...RESULTS.gp, status: "cancelled" } });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    expect(screen.getByText("GP cancelado, 0 puntos.")).toBeInTheDocument();
    // El resto de la vista no se muestra.
    expect(screen.queryByText("Mis posiciones")).not.toBeInTheDocument();
    expect(screen.queryByText("170,5 puntos")).not.toBeInTheDocument();
  });

  it("sin resultados definitivos: aviso + error del desglose", async () => {
    mockSeasons();
    mockGps();
    mockResults({
      ...RESULTS,
      state: {
        gpId: GP2.id,
        gpName: GP2.name,
        round: 2,
        seasonName: "Temporada 2099",
        definitive: false,
        resultsVersion: null,
        counts: { provisional: 36, definitive: 0, corrected: 0 },
        totalResults: 36,
        lineups: 12,
      },
    });
    mockResult(trpc.results.myScore.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error(
        "Este GP aún no tiene resultados definitivos; tu puntuación aparecerá cuando se marquen definitivos.",
      ),
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    expect(
      screen.getByText("Aún no hay resultados definitivos en este GP."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Este GP aún no tiene resultados definitivos/),
    ).toBeInTheDocument();
    expect(screen.queryByText("170,5 puntos")).not.toBeInTheDocument();
  });

  it("muestra el error si `myResults` falla", async () => {
    mockSeasons();
    mockGps();
    mockResult(trpc.results.myResults.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("El GP no existe."),
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    expect(screen.getByText("El GP no existe.")).toBeInTheDocument();
  });

  it("muestra 'Aún no formas parte de ninguna liga' cuando no hay ligas", async () => {
    mockSeasons();
    mockGps();
    mockResults({ ...RESULTS, leagues: [] });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    expect(screen.getByText("Aún no formas parte de ninguna liga.")).toBeInTheDocument();
  });

  it("muestra 'sin posición en este GP' cuando la posición es null", async () => {
    mockSeasons();
    mockGps();
    mockResults({
      ...RESULTS,
      leagues: [
        {
          ...LEAGUE,
          gpPosition: null,
          gpPoints: null,
          overallPosition: null,
          overallPoints: null,
          delta: null,
        },
      ],
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    expect(screen.getByText("— sin posición en este GP")).toBeInTheDocument();
  });

  it("muestra el plural 'correcciones' y entradas sin motivo ni actor", async () => {
    mockSeasons();
    mockGps();
    mockResults({
      ...RESULTS,
      recalculation: {
        corrections: 2,
        lastAt: null,
        history: [
          {
            riderId: "r2",
            riderName: "Piloto B",
            eventLabel: "Q2",
            before: {
              position: 2,
              started: true,
              finished: true,
              penalties: [],
              bonuses: [],
              rawPoints: null,
            },
            after: {
              position: 3,
              started: true,
              finished: true,
              penalties: [],
              bonuses: [],
              rawPoints: null,
            },
            reason: "",
            actor: null,
            at: new Date("2026-10-25T09:00:00Z"),
          },
          {
            riderId: "r6",
            riderName: "Piloto I",
            eventLabel: "sprint",
            before: {
              position: 9,
              started: true,
              finished: true,
              penalties: [],
              bonuses: [],
              rawPoints: null,
            },
            after: {
              position: 8,
              started: true,
              finished: true,
              penalties: [],
              bonuses: [],
              rawPoints: null,
            },
            reason: "Corrección de posición",
            actor: "admin_a",
            at: new Date("2026-10-25T10:00:00Z"),
          },
        ],
      },
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    // Plural + sin fecha (lastAt null).
    expect(screen.getByText(/2 correcciones/)).toBeInTheDocument();
    // Entrada sin motivo ni actor (solo antes → nuevo).
    expect(screen.getByText(/\(Q2\): pos\. 2, terminó → pos\. 3, terminó/)).toBeInTheDocument();
    // Entrada con motivo + actor.
    expect(screen.getByText(/\(sprint\): pos\. 9, terminó → pos\. 8, terminó/)).toBeInTheDocument();
    expect(screen.getByText("— Corrección de posición")).toBeInTheDocument();
    expect(screen.getByText("(por admin_a)")).toBeInTheDocument();
  });

  it("muestra el delta positivo (subió) con la clase ok", async () => {
    mockSeasons();
    mockGps();
    mockResults({
      ...RESULTS,
      leagues: [{ ...LEAGUE, gpPosition: 1, gpPoints: 170.5, delta: 1 }],
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    const delta = screen.getByText("▲ +1 vs GP anterior");
    expect(delta).toHaveClass("ok");
  });
});
