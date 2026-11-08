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
import type { MyScoreView } from "@/modules/results";

import ResultadosPage from "../resultados-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

const SEASON_ID = "season-2099";
const GP1 = { id: "gp-1", name: "GP de Jerez", round: 1, status: "scheduled" };
const GP2 = { id: "gp-2", name: "GP de Le Mans", round: 2, status: "finished" };

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
const SCORE: MyScoreView = {
  gpId: GP2.id,
  gpName: GP2.name,
  round: 2,
  seasonName: "Temporada 2099",
  status: "definitive",
  eventsIncluded: ["q2", "sprint", "race"],
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
  manufacturer: { id: "ctor-x", name: "Constructor X", points: 38 },
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

function mockGps(gps: Array<typeof GP1> = [GP1, GP2]) {
  mockResult(trpc.seasons.gps.list.useQuery, {
    data: gps,
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

function mockScore(score: MyScoreView) {
  mockResult(trpc.results.myScore.useQuery, {
    data: score,
    isPending: false,
    isError: false,
  });
}

/**
 * Error tRPC con código (shape v11 transformada: `data.code`), como el que
 * llega del servidor para los estados legítimos de `myScore`.
 */
function trpcError(message: string, code: string) {
  return Object.assign(new Error(message), { data: { code } });
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

  it("elige la temporada más reciente y el primer GP programado por defecto", () => {
    mockSeasons();
    mockGps();
    renderResultados(<ResultadosPage />);

    // Temporada por defecto: la más reciente (orden ascendente → última).
    expect(screen.getByLabelText("Temporada")).toHaveValue(SEASON_ID);
    // GP por defecto: el primero programado por ronda.
    expect(screen.getByLabelText("GP")).toHaveValue(GP1.id);
    expect(screen.getByRole("option", { name: "J2 · GP de Le Mans" })).toBeInTheDocument();
  });

  it("sin GP programado no preselecciona ningún GP", () => {
    mockSeasons();
    mockGps([
      { id: "gp-1", name: "GP de Jerez", round: 1, status: "finished" },
      { id: "gp-2", name: "GP de Le Mans", round: 2, status: "finished" },
    ]);
    renderResultados(<ResultadosPage />);

    expect(screen.getByLabelText("Temporada")).toHaveValue(SEASON_ID);
    expect(screen.getByLabelText("GP")).toHaveValue("");
    expect(
      screen.getByText("Selecciona un GP para ver tus resultados."),
    ).toBeInTheDocument();
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
    // Estado del GP (animate A2): chip definitivo (ok) + versión en muted;
    // los dos estados son mutuamente excluyentes (el chip lleva uno solo).
    const chipDef = screen.getByText("Definitivo");
    expect(chipDef).toHaveClass("gp-state", "gp-state--definitive");
    expect(chipDef).not.toHaveClass("gp-state--provisional");
    expect(screen.getByText("(versión rv-2)")).toBeInTheDocument();

    // Capa de ayuda de vocabulario (F3): delta, general, provisional, corrección.
    expect(screen.getByText(/Delta \(▲\/▼\): cambio de posición/)).toBeInTheDocument();
    expect(screen.getByText(/General: posición acumulada en la liga/)).toBeInTheDocument();
    expect(screen.getByText(/Corrección: ajuste de un resultado/)).toBeInTheDocument();

    // Posición en la liga + delta negativo (bajó 1) + general.
    expect(screen.getByText("Liga A")).toBeInTheDocument();
    expect(screen.getByText(/posición 2 \(120,5 pts\)/)).toBeInTheDocument();
    expect(screen.getByText("▼ 1 vs GP anterior")).toBeInTheDocument();
    // Delta negativo = dato, no fallo → neutro (muted), no rojo (F3 P2).
    expect(screen.getByText("▼ 1 vs GP anterior")).toHaveClass("muted");
    expect(screen.getByText(/general: 2 \(240,5 pts\)/)).toBeInTheDocument();

    // Recálculo: aviso + histórico anterior → nuevo (motivo + actor).
    // Barrido P3: el titular usa el término "Correcciones" (coherente con la
    // capa de ayuda que define "Corrección"; antes "Resultados actualizados").
    expect(
      screen.getByRole("heading", { level: 3, name: "Correcciones" }),
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
      error: trpcError(
        "Este GP aún no tiene resultados importados; tu puntuación aparecerá cuando se importen los resultados o se marquen definitivos.",
        "PRECONDITION_FAILED",
      ),
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    // Estado del GP (animate A2): chip provisional (info, no aviso) + detalle
    // muted; mutuamente excluyente del definitivo.
    const chipProv = screen.getByText("Provisional");
    expect(chipProv).toHaveClass("gp-state", "gp-state--provisional");
    expect(chipProv).not.toHaveClass("gp-state--definitive");
    expect(screen.getByText("aún sin confirmar")).toBeInTheDocument();
    expect(
      screen.getByText(/Este GP aún no tiene resultados importados/),
    ).toBeInTheDocument();
    // Estado legítimo (sin resultados) → neutro (info), no error (rojo) (F3 P1).
    expect(
      screen
        .getByText(/Este GP aún no tiene resultados importados/)
        .closest("p"),
    ).toHaveClass("alert-info");
    expect(screen.queryByText("170,5 puntos")).not.toBeInTheDocument();
  });

  it("sin lineup: estado neutro (info) con enlace a /lineups, no error rojo", async () => {
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
        counts: { provisional: 0, definitive: 0, corrected: 0 },
        totalResults: 0,
        lineups: 0,
      },
    });
    mockResult(trpc.results.myScore.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: trpcError("No tienes lineup para este GP.", "NOT_FOUND"),
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    // Estado legítimo (sin lineup) → neutro (info), no error (rojo) (F3 P1).
    expect(screen.getByText(/No tienes lineup para este GP/).closest("p")).toHaveClass(
      "alert-info",
    );
    // Salida accionable: enlace a montar el lineup.
    expect(
      screen.getByRole("link", { name: "Monta tu lineup" }),
    ).toHaveAttribute("href", "/lineups");
  });

  it("fallo real de `myScore`: error rojo con el motivo del servidor", async () => {
    mockSeasons();
    mockGps();
    mockResults({ ...RESULTS });
    mockResult(trpc.results.myScore.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("Fallo interno del servidor."),
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    // Fallo real (sin código legítimo) → error (rojo).
    expect(
      screen.getByText("Fallo interno del servidor.").closest("p"),
    ).toHaveClass("alert-error");
  });

  it("`NOT_FOUND` «GP no existe» (sobrecarga del código): fallo real, sin CTA de lineup (F3 P2)", async () => {
    mockSeasons();
    mockGps();
    mockResults({ ...RESULTS });
    mockResult(trpc.results.myScore.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      // Mismo código `NOT_FOUND` que «sin lineup», pero el mensaje no es de
      // lineup → fallo real, no estado legítimo.
      error: trpcError("El GP no existe.", "NOT_FOUND"),
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    // Fallo real → error (rojo), NO el estado neutro «sin lineup».
    expect(screen.getByText("El GP no existe.").closest("p")).toHaveClass(
      "alert-error",
    );
    // Sin la salida accionable de «sin lineup».
    expect(
      screen.queryByRole("link", { name: "Monta tu lineup" }),
    ).not.toBeInTheDocument();
  });

  it("provisional (ADR-0031): aviso + desglose provisional con eventos", async () => {
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
    mockScore({
      ...SCORE,
      status: "provisional",
      eventsIncluded: ["q2", "sprint"],
      resultsVersion: null,
      computedAt: null,
    });
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    await openGp2(user);

    // El GP no es definitivo todavía… (animate A2: chip provisional, no texto)
    const chipProv = screen.getByText("Provisional");
    expect(chipProv).toHaveClass("gp-state", "gp-state--provisional");
    // …pero el desglose se muestra como provisional, con los eventos.
    expect(screen.getByText("170,5 puntos")).toBeInTheDocument();
    // Barrido P3: la línea de Total se limita a la versión de reglas; la
    // explicación de "provisional" vive en el aviso del desglose (sin duplicar).
    expect(screen.getByText(/reglas scoring-v1/)).toBeInTheDocument();
    expect(screen.getByText("Puntuación provisional")).toBeInTheDocument();
    expect(screen.getByText(/Q2, Sprint/)).toBeInTheDocument();
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

    expect(screen.getByText(/Aún no formas parte de ninguna liga/)).toBeInTheDocument();
    // Salida accionable: enlace al directorio de ligas (F3 P1).
    expect(screen.getByRole("link", { name: "Explora las ligas" })).toHaveAttribute(
      "href",
      "/ligas",
    );
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

  it("barrido P3: respeta la deselección explícita del GP (sin snap-back)", async () => {
    mockSeasons();
    mockGps();
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    // La auto-selección elige la última temporada y el GP programado (GP1).
    const gpSelect = await screen.findByLabelText("GP");
    expect(gpSelect).toHaveValue(GP1.id);

    // El usuario deselecciona el GP a propósito ("— GP —").
    await user.selectOptions(gpSelect, "");

    // Se respeta la deselección (no snap-back): el GP queda vacío…
    expect(screen.getByLabelText("GP")).toHaveValue("");
    // …y la pista lo indica (el selector de GP está visible).
    expect(
      screen.getByText("Selecciona un GP para ver tus resultados."),
    ).toBeInTheDocument();
  });

  it("barrido P3: sin temporada seleccionada pide la temporada (no el GP)", async () => {
    mockSeasons();
    mockGps();
    renderResultados(<ResultadosPage />);

    const user = userEvent.setup();
    // La auto-selección elige la temporada y el GP.
    await screen.findByLabelText("GP");

    // El usuario deselecciona la TEMPORADA a propósito ("— Temporada —").
    await user.selectOptions(screen.getByLabelText("Temporada"), "");

    // La pista pide la temporada (el selector de GP no está renderizado).
    expect(
      screen.getByText("Selecciona una temporada para ver tus resultados."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Selecciona un GP para ver tus resultados."),
    ).not.toBeInTheDocument();
  });

  it("barrido P3: sin temporadas no hay pista engañosa", () => {
    // Sin temporadas (lista vacía): ni temporada ni GP que elegir.
    mockResult(trpc.seasons.list.useQuery, {
      data: [],
      isPending: false,
      isError: false,
    });
    renderResultados(<ResultadosPage />);

    // No hay pista "Selecciona un GP…" (el selector de GP no está renderizado)…
    expect(
      screen.queryByText("Selecciona un GP para ver tus resultados."),
    ).not.toBeInTheDocument();
    // …ni la de temporada (no hay temporadas que elegir).
    expect(
      screen.queryByText("Selecciona una temporada para ver tus resultados."),
    ).not.toBeInTheDocument();
  });
});
