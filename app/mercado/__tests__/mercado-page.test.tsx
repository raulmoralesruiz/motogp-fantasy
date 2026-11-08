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
import { render, screen, userEvent, within } from "../../../test/rtl";

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
  delta: 2,
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
  delta: null,
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
  delta: -5,
  miniHistory: [
    { gpId: null, gpRound: null, gpName: null, price: 35 },
    { gpId: "gp-1", gpRound: 1, gpName: "GP de Qatar", price: 30 },
  ],
  popularity: 1,
};

/** Activo con precios decimales (es-ES: se muestran con coma). */
const RIDER_D: MarketAssetView = {
  assetId: "r4",
  name: "Piloto Cuatro",
  constructorId: "ctor-a",
  constructorName: "Ctor A",
  teamId: "team-a",
  teamName: "Team A",
  currentPrice: 17.4,
  isP0Fallback: false,
  trend: "up",
  delta: 2.6,
  miniHistory: [
    { gpId: null, gpRound: null, gpName: null, price: 14.8 },
    { gpId: "gp-1", gpRound: 1, gpName: "GP de Qatar", price: 17.4 },
  ],
  popularity: 2,
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
  delta: null,
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
    // Tendencia con Δ (F3): dirección + magnitud junto a la insignia.
    // RIDER_B solo tiene P0 (sin punto anterior) → solo la etiqueta.
    expect(screen.getByText("Sube +2")).toBeInTheDocument();
    expect(screen.getByText("Estable")).toBeInTheDocument();
    expect(screen.getByText("Baja −5")).toBeInTheDocument();

    // Mini-histórico: un sparkline por activo (SVG con aria-label).
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(
      screen.getByRole("img", { name: "Mini-histórico: P0 20; J1 22" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Mini-histórico: P0 10" }),
    ).toBeInTheDocument();

    // Popularidad (nº de lineups del GP que contienen el activo): última celda.
    const rows = screen.getAllByRole("row").slice(1);
    const popularity = (i: number) =>
      rows[i]?.querySelectorAll("td").item(4)?.textContent;
    expect(popularity(0)).toBe("3");
    expect(popularity(1)).toBe("0");
    expect(popularity(2)).toBe("1");
  });

  it("explica el vocabulario de la tabla (Tendencia, P0, Lineups) antes de la lista (F3)", () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    // Capa de ayuda de vocabulario (patrón F1 de /admin): cada término de la
    // tabla se explica una sola vez, en su primera aparición.
    expect(
      screen.getByText((content) => content.includes("Tendencia:")),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("(P0):")),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("Lineups:")),
    ).toBeInTheDocument();
  });

  it("agrupa los selectores Temporada y GP en una fila apilada (F3)", () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const stack = document.querySelector(".stack");
    expect(stack).toBeInTheDocument();
    expect(stack).toContainElement(screen.getByLabelText("Temporada"));
    expect(stack).toContainElement(screen.getByLabelText("GP"));
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
      screen.getByText(
        "Precio mínimo: introduce un número válido (usa coma para decimales, p. ej. 17,4).",
      ),
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
      screen.getByText("Precio mínimo: máximo 2 decimales (p. ej. 17,45)."),
    ).toBeInTheDocument();
    expect(lastListInput()).not.toHaveProperty("priceMin");
  });

  it("precio con coma decimal (es-ES): se acepta y envía como número", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio mínimo"), "17,4");
    await user.type(screen.getByLabelText("Precio máximo"), "29,99");

    expect(lastListInput()).toMatchObject({ priceMin: 17.4, priceMax: 29.99 });
    // Sin error: el campo NO lleva aria-invalid.
    expect(screen.getByLabelText("Precio mínimo")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("precios decimales: display con coma (es-ES) en lista, tendencia y sparkline", async () => {
    mockSeasons();
    mockGps();
    mockMarketList([RIDER_D]);
    renderMercado(<MercadoPage />);

    // Precio actual de la fila: 17,4 (no 17.4).
    expect(screen.getByText("17,4")).toBeInTheDocument();
    expect(screen.queryByText("17.4")).not.toBeInTheDocument();

    // Tendencia con Δ: +2,6 (no +2.6).
    expect(screen.getByText("Sube +2,6")).toBeInTheDocument();

    // Sparkline (aria): valores con coma.
    expect(
      screen.getByRole("img", { name: "Mini-histórico: P0 14,8; J1 17,4" }),
    ).toBeInTheDocument();
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

    // Sin error: el campo NO lleva aria-invalid (negativo de la aserción aria).
    expect(screen.getByLabelText("Precio mínimo")).not.toHaveAttribute(
      "aria-invalid",
    );
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
      screen.getByRole("heading", { level: 2, name: "Detalle — Piloto Uno" }),
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
      screen.getByRole("img", { name: "Histórico de precios: P0 20; J1 22" }),
    ).toBeInTheDocument();

    // Histórico completo: P0 (manual) + J1 (fórmula).
    expect(screen.getByRole("heading", { level: 3, name: "Historial completo" }))
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
      screen.getByRole("heading", { level: 2, name: "Detalle — Piloto Uno" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(
      screen.queryByRole("heading", { level: 3, name: "Detalle — Piloto Uno" }),
    ).not.toBeInTheDocument();
  });

  it("detalle: la tendencia muestra la variación (Δ) del servidor (F3)", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_R1);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));

    // Δ calculado en el servidor (mismo punto anterior que la tendencia).
    // RIDER_A también aparece en el listado (mismo badge), así que acotamos
    // la consulta al contenedor del detalle (el h2 vive en su <div> padre).
    const detail = within(
      screen
        .getByRole("heading", { level: 2, name: "Detalle — Piloto Uno" })
        .closest("div") as HTMLElement,
    );
    expect(detail.getByText("Sube +2")).toBeInTheDocument();
  });

  it("el botón Cerrar del detalle vive en una fila de acción (F3)", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    mockDetail(DETAIL_R1);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto Uno" }));

    const actionRow = document.querySelector(".action-row");
    expect(actionRow).toBeInTheDocument();
    expect(actionRow).toContainElement(
      screen.getByRole("button", { name: "Cerrar" }),
    );
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
      screen.getByRole("heading", { level: 2, name: "Detalle — Piloto Uno" }),
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

  it("estado vacío: 'Borrar filtros' limpia el cluster y re-pide la lista (F3)", async () => {
    mockSeasons();
    mockGps();
    mockMarketList([]);
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio mínimo"), "5");
    expect(lastListInput()).toMatchObject({ priceMin: 5 });

    // Salida del estado vacío: un solo control limpia todos los filtros.
    await user.click(screen.getByRole("button", { name: "Borrar filtros" }));

    expect(screen.getByLabelText("Precio mínimo")).toHaveValue("");
    expect(lastListInput()).not.toHaveProperty("priceMin");
  });

  it("precio mínimo superior al máximo: error local y NO envía el filtro", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio mínimo"), "10000");

    expect(
      screen.getByText("Precio mínimo: el precio no puede superar 9999,99."),
    ).toBeInTheDocument();
    expect(lastListInput()).not.toHaveProperty("priceMin");
  });

  it("rango imposible (mín > máx): error local y NO envía los precios (F3)", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio mínimo"), "20");
    await user.type(screen.getByLabelText("Precio máximo"), "10");

    // Un rango imposible es un error de usuario que hay que nombrar, no un
    // "Ningún activo coincide" disfrazado de resultado.
    expect(
      screen.getByText("El mínimo no puede superar el máximo."),
    ).toBeInTheDocument();
    expect(lastListInput()).not.toHaveProperty("priceMin");
    expect(lastListInput()).not.toHaveProperty("priceMax");

    // El error queda asociado al campo (aria) para lectores de pantalla (F3).
    const minInput = screen.getByLabelText("Precio mínimo");
    expect(minInput).toHaveAttribute("aria-invalid", "true");
    expect(minInput).toHaveAttribute("aria-describedby", "price-min-error");
  });

  it("precio máximo inválido: error local asociado al campo (aria) (F3)", async () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Precio máximo"), "abc");

    expect(
      screen.getByText(
        "Precio máximo: introduce un número válido (usa coma para decimales, p. ej. 17,4).",
      ),
    ).toBeInTheDocument();
    const maxInput = screen.getByLabelText("Precio máximo");
    expect(maxInput).toHaveAttribute("aria-invalid", "true");
    expect(maxInput).toHaveAttribute("aria-describedby", "price-max-error");
  });

  it("el bloque del GP lleva un h2 con el nombre del GP (F3)", () => {
    mockSeasons();
    mockGps();
    mockMarketList();
    renderMercado(<MercadoPage />);

    // Mismo patrón que "Mi puntuación — GP" (/puntuacion) y
    // "Mis resultados — GP" (/resultados): el bloque de contenido se nombra.
    expect(
      screen.getByRole("heading", { level: 2, name: "Mercado — GP de Qatar" }),
    ).toBeInTheDocument();
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
      screen.getByRole("heading", { level: 2, name: "Detalle — Piloto Uno" }),
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
      screen.getByRole("heading", { level: 2, name: "Detalle — Piloto Uno" }),
    ).toBeInTheDocument();

    // Filtro que excluye al activo de la lista; el detalle sigue pendiente.
    await user.type(screen.getByLabelText("Precio mínimo"), "100");

    expect(
      screen.getByRole("heading", { level: 2, name: "Detalle — r1" }),
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
      screen.getByRole("img", { name: "Histórico de precios: P0 20; J1 20" }),
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
