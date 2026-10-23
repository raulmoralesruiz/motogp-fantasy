// @vitest-environment jsdom
/**
 * Tests de `app/mercado/mercado-page.tsx` (US-14): temporada/GP por
 * defecto, pestañas por tipo de activo, filtros (constructor/equipo solo
 * riders; rango de precio con validación local), lista con precio actual
 * (con fallback P0), tendencia, mini-histórico y popularidad, y detalle
 * con gráfico completo e histórico — todo sobre el `trpc` mockeado.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import type { MarketAssetView, MarketDetailView } from "../../modules/market";
import MercadoPage from "../mercado-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

const SEASON_2025 = "season-2025";
const SEASON_2026 = "season-2026";
const GP1 = { id: "gp-1", name: "GP de Qatar", round: 1, status: "scheduled" };
const GP2 = { id: "gp-2", name: "GP de España", round: 2, status: "scheduled" };

const RIDER_A: MarketAssetView = {
  assetId: "r1",
  name: "Piloto Uno",
  constructorId: "ctor-a",
  constructorName: "Ctor A",
  teamId: "team-a",
  teamName: "Team A",
  currentPrice: 22,
  isP0Fallback: false,
  trend: "up",
  miniHistory: [
    { gpId: null, gpRound: null, gpName: null, price: 20 },
    { gpId: "gp-1", gpRound: 1, gpName: "GP de Qatar", price: 22 },
  ],
  popularity: 3,
};
const RIDER_B: MarketAssetView = {
  assetId: "r2",
  name: "Piloto Dos",
  constructorId: "ctor-b",
  constructorName: "Ctor B",
  teamId: "team-b",
  teamName: "Team B",
  currentPrice: 10,
  isP0Fallback: true,
  trend: "flat",
  miniHistory: [{ gpId: null, gpRound: null, gpName: null, price: 10 }],
  popularity: 0,
};
const RIDER_C: MarketAssetView = {
  assetId: "r3",
  name: "Piloto Tres",
  constructorId: null,
  constructorName: null,
  teamId: null,
  teamName: null,
  currentPrice: 30,
  isP0Fallback: false,
  trend: "down",
  miniHistory: [
    { gpId: null, gpRound: null, gpName: null, price: 35 },
    { gpId: "gp-1", gpRound: 1, gpName: "GP de Qatar", price: 30 },
  ],
  popularity: 1,
};

const DETAIL_R1: MarketDetailView = {
  asset: RIDER_A,
  history: [
    {
      id: "p0",
      gpRound: null,
      gpName: null,
      price: 20,
      reason: "manual",
      createdAt: new Date("2026-09-01T09:00:00Z"),
    },
    {
      id: "p1",
      gpRound: 1,
      gpName: "GP de Qatar",
      price: 22,
      reason: "formula",
      createdAt: new Date("2026-06-01T09:00:00Z"),
    },
  ],
};

/** Detalle sin precio ni histórico (activo sin P0 ni precios por GP). */
const DETAIL_SIN_PRECIO: MarketDetailView = {
  asset: { ...RIDER_B, currentPrice: null },
  history: [],
};

/** Detalle con un único punto de histórico (solo P0). */
const DETAIL_P0_ONLY: MarketDetailView = {
  asset: RIDER_A,
  history: [
    {
      id: "p0",
      gpRound: null,
      gpName: null,
      price: 20,
      reason: "manual",
      createdAt: new Date("2026-09-01T09:00:00Z"),
    },
  ],
};

/** Detalle con precios todos iguales (amplitud 0 en el gráfico). */
const DETAIL_PLANO: MarketDetailView = {
  asset: RIDER_A,
  history: [
    {
      id: "p0",
      gpRound: null,
      gpName: null,
      price: 20,
      reason: "manual",
      createdAt: new Date("2026-09-01T09:00:00Z"),
    },
    {
      id: "p1",
      gpRound: 1,
      gpName: "GP de Qatar",
      price: 20,
      reason: "formula",
      createdAt: new Date("2026-06-01T09:00:00Z"),
    },
  ],
};

/** Detalle con fallback a P0 (el GP no tiene precio propio). */
const DETAIL_P0_FALLBACK: MarketDetailView = {
  asset: RIDER_B,
  history: [
    {
      id: "p0",
      gpRound: null,
      gpName: null,
      price: 10,
      reason: "manual",
      createdAt: new Date("2026-09-01T09:00:00Z"),
    },
  ],
};

/** Activo sin ningún precio (ni P0 ni por GP). */
const RIDER_SIN_PRECIO: MarketAssetView = {
  assetId: "r4",
  name: "Piloto Sin Precio",
  constructorId: null,
  constructorName: null,
  teamId: null,
  teamName: null,
  currentPrice: null,
  isP0Fallback: false,
  trend: "flat",
  miniHistory: [],
  popularity: 0,
};

function renderMercado(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

function mockSeasons() {
  mockResult(trpc.seasons.list.useQuery, {
    data: [
      { id: SEASON_2025, name: "2025" },
      { id: SEASON_2026, name: "2026" },
    ],
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

function mockMarketList(data: MarketAssetView[] = [RIDER_A, RIDER_B, RIDER_C]) {
  mockResult(trpc.market.market.list.useQuery, {
    data,
    isPending: false,
    isError: false,
  });
}

function mockConstructors() {
  mockResult(trpc.market.constructors.list.useQuery, {
    data: [
      { id: "ctor-a", name: "Ctor A" },
      { id: "ctor-b", name: "Ctor B" },
    ],
    isPending: false,
    isError: false,
  });
}

function mockTeams() {
  mockResult(trpc.market.teams.list.useQuery, {
    data: [
      { id: "team-a", name: "Team A" },
      { id: "team-b", name: "Team B" },
    ],
    isPending: false,
    isError: false,
  });
}

function mockDetail(data: MarketDetailView) {
  mockResult(trpc.market.market.detail.useQuery, {
    data,
    isPending: false,
    isError: false,
  });
}

/** Input de la ÚLTIMA invocación de `market.market.list.useQuery`. */
function lastListInput(): Record<string, unknown> {
  const calls = asMockFn(trpc.market.market.list.useQuery).mock.calls;
  const last = calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
  return last ?? {};
}

describe("MercadoPage (US-14)", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  it("muestra el estado pendiente", () => {
    renderMercado(<MercadoPage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra un error si la lista de temporadas falla", () => {
    mockResult(trpc.seasons.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderMercado(<MercadoPage />);
    expect(
      screen.getByText("No se pudo cargar la lista de temporadas."),
    ).toBeInTheDocument();
  });

  it("elige la temporada más reciente y el primer GP programado por defecto", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    // Temporada por defecto: la más reciente (orden ascendente → última).
    expect(screen.getByLabelText("Temporada")).toHaveValue(SEASON_2026);
    // GP por defecto: el primero programado por ronda.
    expect(screen.getByLabelText("GP")).toHaveValue(GP1.id);

    // La lista se pide con el GP y el tipo de activo por defecto (riders).
    expect(lastListInput()).toMatchObject({
      gpId: GP1.id,
      assetType: "rider",
    });
  });

  it("muestra la lista: precio (con fallback P0), tendencia, mini-histórico y popularidad", () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    // Nombres + afiliación de los riders.
    expect(screen.getByRole("button", { name: "Piloto Uno" })).toBeInTheDocument();
    expect(screen.getByText("Ctor A · Team A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Piloto Dos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Piloto Tres" })).toBeInTheDocument();

    // Precios: 22 (GP), 10 (fallback P0) y 30.
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("(P0)")).toBeInTheDocument();

    // Tendencia: sube / estable / baja.
    expect(screen.getByText("Sube")).toBeInTheDocument();
    expect(screen.getByText("Estable")).toBeInTheDocument();
    expect(screen.getByText("Baja")).toBeInTheDocument();

    // Mini-histórico: un sparkline por activo (SVG con aria-label).
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(
      screen.getByRole("img", { name: "Mini-histórico: 20, 22" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Mini-histórico: 10" }),
    ).toBeInTheDocument();

    // Popularidad (nº de lineups del GP que contienen el activo): última celda.
    const rows = screen.getAllByRole("row").slice(1);
    const popularity = (i: number) =>
      rows[i]?.querySelectorAll("td").item(4)?.textContent;
    expect(popularity(0)).toBe("3");
    expect(popularity(1)).toBe("0");
    expect(popularity(2)).toBe("1");
  });

  it("sin GP programado no preselecciona ningún GP", () => {
    mockSeasons();
    mockGps([
      { id: "gp-1", name: "GP de Qatar", round: 1, status: "finished" },
      { id: "gp-2", name: "GP de España", round: 2, status: "finished" },
    ]);
    mockMarketList();
    renderMercado(<MercadoPage />);

    expect(screen.getByLabelText("GP")).toHaveValue("");
    expect(
      screen.getByText("Selecciona un GP para explorar el mercado."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("muestra los filtros de constructor/equipo solo en la pestaña de pilotos", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockConstructors();
    mockTeams();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();

    expect(screen.getByLabelText("Constructor")).toBeInTheDocument();
    expect(screen.getByLabelText("Equipo")).toBeInTheDocument();

    // Pestaña constructores: sin filtros de constructor/equipo.
    await user.click(screen.getByRole("button", { name: "Constructores" }));
    expect(screen.queryByLabelText("Constructor")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Equipo")).not.toBeInTheDocument();
    expect(lastListInput()).toMatchObject({ assetType: "constructor" });
    expect(lastListInput()).not.toHaveProperty("constructorId");
    expect(lastListInput()).not.toHaveProperty("teamId");
  });

  it("filtro por constructor: envía el constructorId al mercado", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockConstructors();
    mockTeams();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Constructor"), "ctor-a");

    expect(lastListInput()).toMatchObject({
      gpId: GP1.id,
      assetType: "rider",
      constructorId: "ctor-a",
    });
    expect(lastListInput()).not.toHaveProperty("teamId");
  });

  it("filtro por equipo: envía el teamId al mercado", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockConstructors();
    mockTeams();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Equipo"), "team-b");

    expect(lastListInput()).toMatchObject({ teamId: "team-b" });
    expect(lastListInput()).not.toHaveProperty("constructorId");
  });

  it("precio mínimo inválido: error local y NO envía el filtro", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio mínimo"), "abc");

    expect(
      screen.getByText("Precio mínimo: introduce un número positivo."),
    ).toBeInTheDocument();
    expect(lastListInput()).not.toHaveProperty("priceMin");
  });

  it("precio mínimo con más de 2 decimales: error local", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio mínimo"), "10.555");

    expect(
      screen.getByText("Precio mínimo: máximo 2 decimales."),
    ).toBeInTheDocument();
    expect(lastListInput()).not.toHaveProperty("priceMin");
  });

  it("rango de precio válido: envía priceMin y priceMax", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio mínimo"), "10");
    await user.type(screen.getByLabelText("Precio máximo"), "25.5");

    expect(lastListInput()).toMatchObject({ priceMin: 10, priceMax: 25.5 });
  });

  it("muestra el detalle del activo: precio, popularidad, gráfico e histórico", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_R1);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));

    expect(
      screen.getByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).toBeInTheDocument();

    // Vista del activo en el GP.
    expect(screen.getByText("Precio actual:")).toBeInTheDocument();
    expect(
      screen.getByText("Lineups de este GP que contienen el activo:"),
    ).toBeInTheDocument();
    expect(screen.getByText("Constructor:")).toBeInTheDocument();
    expect(screen.getByText("Ctor A")).toBeInTheDocument();
    expect(screen.getByText("Equipo:")).toBeInTheDocument();
    expect(screen.getByText("Team A")).toBeInTheDocument();

    // Gráfico completo (SVG) con las etiquetas P0 / J1.
    expect(
      screen.getByRole("img", { name: "Histórico de precios: P0 20, J1 22" }),
    ).toBeInTheDocument();

    // Histórico completo: P0 (manual) + J1 (fórmula).
    expect(screen.getByRole("heading", { level: 4, name: "Historial completo" }))
      .toBeInTheDocument();
    const rows = screen.getAllByRole("table")[1]?.querySelectorAll("tbody tr") ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("P0");
    expect(rows[0]?.textContent).toContain("Manual");
    expect(rows[0]?.textContent).toContain("20");
    expect(rows[0]?.textContent).toContain("2026-09-01");
    expect(rows[1]?.textContent).toContain("J1");
    expect(rows[1]?.textContent).toContain("GP de Qatar");
    expect(rows[1]?.textContent).toContain("Fórmula");
    expect(rows[1]?.textContent).toContain("22");
  });

  it("cierra el detalle con el botón Cerrar", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_R1);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));
    expect(
      screen.getByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(
      screen.queryByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).not.toBeInTheDocument();
  });

  it("al cambiar de GP se limpia la selección y se re-pide la lista", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_R1);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));
    expect(
      screen.getByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("GP"), GP2.id);

    expect(
      screen.queryByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).not.toBeInTheDocument();
    expect(lastListInput()).toMatchObject({ gpId: GP2.id });
  });

  it("muestra un error si la lista del mercado falla", () => {
    mockSeasons();
    mockGps();
    mockResult(trpc.market.market.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderMercado(<MercadoPage />);

    expect(screen.getByText("No se pudo cargar el mercado del GP.")).toBeInTheDocument();
  });

  it("muestra un error si el detalle falla", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockResult(trpc.market.market.detail.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));

    expect(
      screen.getByText("No se pudo cargar el detalle del activo."),
    ).toBeInTheDocument();
  });

  it("lista vacía con filtros: mensaje de vacío", () => {
    mockSeasons();
    mockGps();
    mockMarketList([]);
    renderMercado(<MercadoPage />);

    expect(
      screen.getByText("Ningún activo coincide con los filtros."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("precio mínimo superior al máximo: error local y NO envía el filtro", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio mínimo"), "10000");

    expect(
      screen.getByText("Precio mínimo: el precio no puede superar 9999.99."),
    ).toBeInTheDocument();
    expect(lastListInput()).not.toHaveProperty("priceMin");
  });

  it("activo sin precio en la lista: guion en la celda de precio", () => {
    mockSeasons();
    mockGps();
    mockMarketList([RIDER_SIN_PRECIO]);
    renderMercado(<MercadoPage />);

    expect(
      screen.getByRole("button", { name: "Piloto Sin Precio" }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]?.querySelectorAll("td").item(1)?.textContent).toBe("—");
  });

  it("al cambiar de temporada se resetea el GP y la selección", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_R1);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));
    expect(
      screen.getByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_2025);

    expect(screen.getByLabelText("Temporada")).toHaveValue(SEASON_2025);
    // La selección se limpia al cambiar de temporada.
    expect(
      screen.queryByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).not.toBeInTheDocument();
    // El GP por defecto de la nueva temporada se re-selecciona.
    expect(screen.getByLabelText("GP")).toHaveValue(GP1.id);
  });

  it("si el activo sale de la lista y el detalle no ha cargado, el título cae al ID", async () => {
    mockSeasons();
    mockGps();
    // Con filtro de precio → lista vacía (el activo ya no aparece).
    asMockFn(trpc.market.market.list.useQuery).mockImplementation((input) => {
      const i = input as { priceMin?: number };
      return {
        data: i.priceMin === undefined ? [RIDER_A] : [],
        isPending: false,
        isError: false,
      };
    });
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));
    expect(
      screen.getByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).toBeInTheDocument();

    // Filtro que excluye al activo de la lista; el detalle sigue pendiente.
    await user.type(screen.getByLabelText("Precio mínimo"), "100");

    expect(
      screen.getByRole("heading", { level: 3, name: "Detalle — r1" }),
    ).toBeInTheDocument();
  });

  it("detalle sin precio ni histórico: guion y mensaje de vacío", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_SIN_PRECIO);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Dos" }));

    expect(screen.getByText("Sin histórico de precios.")).toBeInTheDocument();
    const li = screen.getByText("Precio actual:").closest("li");
    expect(li?.textContent).toContain("—");
  });

  it("detalle con un solo punto de histórico: gráfico de un punto", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_P0_ONLY);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));

    expect(
      screen.getByRole("img", { name: "Histórico de precios: P0 20" }),
    ).toBeInTheDocument();
  });

  it("detalle con precios todos iguales: gráfico centrado", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_PLANO);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));

    expect(
      screen.getByRole("img", { name: "Histórico de precios: P0 20, J1 20" }),
    ).toBeInTheDocument();
  });

  it("detalle con fallback P0: etiqueta de precio de apertura", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_P0_FALLBACK);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Dos" }));

    expect(screen.getByText("(precio de apertura P0)")).toBeInTheDocument();
  });
});
