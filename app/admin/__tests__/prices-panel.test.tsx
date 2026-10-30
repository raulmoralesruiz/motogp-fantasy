// @vitest-environment jsdom
/**
 * Tests de `app/admin/prices-panel.tsx` (US-07, ADR-0014): panel de
 * precios de apertura P0 — lista de activos con/sin P0, fijar P0 (upsert
 * auditado con estados creado/actualizado/sin cambios), botón desactivado
 * mientras guarda, histórico del activo elegido (P0 → ronda) y estados de
 * carga/error/vacío de la lista y del histórico.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks, trpc, asMockFn } from "../../../test/trpc-mock";
import { render, screen, userEvent, within } from "../../../test/rtl";

import PricesPanel from "../prices-panel";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const riderAsset = { assetId: "r1", name: "Francesco Bagnaia", openingPrice: 20 };
const riderAssetNoP0 = { assetId: "r2", name: "Marc Márquez", openingPrice: null };

const historyRows = [
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
];

function mockAssets(data: unknown, refetch: ReturnType<typeof vi.fn> = vi.fn()) {
  mockResult(trpc.market.prices.list.useQuery, {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch,
  });
}

// US-08: temporadas y GPs para la sección de precios por GP.
const season = { id: "s1", name: "MotoGP 2099", year: 2099 };
const gps = [
  { id: "gp1", round: 1, name: "GP de Qatar", status: "finished" },
  { id: "gp2", round: 2, name: "GP de Argentina", status: "scheduled" },
];

function mockSeasons(data: unknown) {
  mockResult(trpc.seasons.list.useQuery, {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
}

function mockGps(data: unknown) {
  mockResult(trpc.seasons.gps.list.useQuery, {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
}

/** Selecciona la temporada y el GP de los dos selectores. */
async function pickSeasonAndGps(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
  await user.selectOptions(screen.getByLabelText("GP (objetivo del precio manual)"), "gp2");
  await user.selectOptions(screen.getByLabelText("GP definitivo (fuente de la fórmula)"), "gp1");
}

function mockHistory(data: unknown, refetch: ReturnType<typeof vi.fn> = vi.fn()) {
  mockResult(trpc.market.prices.history.useQuery, {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch,
  });
}

describe("PricesPanel", () => {
  beforeEach(() => resetTrpcMocks());

  it("muestra el panel con el tipo por defecto (pilotos) y el botón desactivado", () => {
    render(<PricesPanel />);

    expect(screen.getByLabelText("Tipo de activo")).toHaveValue("rider");
    // Lista de activos pendiente por defecto.
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fijar P0" })).toBeDisabled();
    expect(screen.queryByText("Historial de precios")).not.toBeInTheDocument();
  });

  it("consulta los activos del tipo elegido y resetea el activo al cambiar de tipo", async () => {
    mockAssets([riderAsset]);
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");
    await user.type(screen.getByLabelText("Precio de apertura (P0)"), "25");
    await user.selectOptions(screen.getByLabelText("Tipo de activo"), "constructor");

    const calls = asMockFn(trpc.market.prices.list.useQuery).mock.calls;
    expect(calls[calls.length - 1]?.[0]).toEqual({ assetType: "constructor" });
    expect(screen.getByLabelText("Activo")).toHaveValue("");
    // Input number vacío: jest-dom normaliza el valor a `null`.
    expect(screen.getByLabelText("Precio de apertura (P0)")).toHaveValue(null);
  });

  it("muestra los activos con y sin P0", () => {
    mockAssets([riderAsset, riderAssetNoP0]);
    render(<PricesPanel />);

    // Acotado a la lista: los nombres también aparecen en las opciones del
    // selector de activo.
    const list = screen.getByRole("list");
    expect(within(list).getByText("Francesco Bagnaia")).toBeInTheDocument();
    expect(within(list).getByText("— P0: 20")).toBeInTheDocument();
    expect(within(list).getByText("Marc Márquez")).toBeInTheDocument();
    expect(within(list).getByText("— sin P0")).toBeInTheDocument();
  });

  it("muestra el estado vacío de la lista de activos", () => {
    mockAssets([]);
    render(<PricesPanel />);

    expect(screen.getByText("Aún no hay activos de este tipo.")).toBeInTheDocument();
  });

  it("muestra el error al cargar la lista de activos", () => {
    mockResult(trpc.market.prices.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    render(<PricesPanel />);

    expect(
      screen.getByText("No se pudieron cargar los activos: sin conexión"),
    ).toBeInTheDocument();
  });

  it("fija el P0 del activo elegido (setOpening)", async () => {
    mockAssets([riderAsset]);
    const mutate = vi.fn();
    mockResult(trpc.market.prices.setOpening.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");
    await user.type(screen.getByLabelText("Precio de apertura (P0)"), "25");
    await user.click(screen.getByRole("button", { name: "Fijar P0" }));

    expect(mutate).toHaveBeenCalledWith({
      assetType: "rider",
      assetId: "r1",
      price: 25,
    });
  });

  it("desactiva el botón hasta que hay activo y precio", async () => {
    mockAssets([riderAsset]);
    render(<PricesPanel />);

    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Fijar P0" })).toBeDisabled();

    // Precio sin activo: sigue desactivado.
    await user.type(screen.getByLabelText("Precio de apertura (P0)"), "25");
    expect(screen.getByRole("button", { name: "Fijar P0" })).toBeDisabled();

    // Con activo y precio: habilitado.
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");
    expect(screen.getByRole("button", { name: "Fijar P0" })).toBeEnabled();
  });

  it("muestra el error al no poder fijar el P0", () => {
    mockResult(trpc.market.prices.setOpening.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("El piloto no existe."),
    });
    render(<PricesPanel />);

    expect(
      screen.getByText("No se pudo fijar el P0: El piloto no existe."),
    ).toBeInTheDocument();
  });

  it("confirma el P0 creado", () => {
    mockResult(trpc.market.prices.setOpening.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { price: 20, status: "created" },
    });
    render(<PricesPanel />);

    expect(screen.getByText("P0 creado.")).toBeInTheDocument();
  });

  it("confirma el P0 actualizado", () => {
    mockResult(trpc.market.prices.setOpening.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { price: 20, status: "updated" },
    });
    render(<PricesPanel />);

    expect(screen.getByText("P0 actualizado.")).toBeInTheDocument();
  });

  it("indica que el P0 ya era ese valor (sin cambios)", () => {
    mockResult(trpc.market.prices.setOpening.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { price: 20, status: "unchanged" },
    });
    render(<PricesPanel />);

    expect(
      screen.getByText("El P0 ya era ese valor (sin cambios)."),
    ).toBeInTheDocument();
  });

  it("muestra el histórico del activo elegido (P0 → ronda)", async () => {
    mockAssets([riderAsset]);
    mockHistory(historyRows);
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");

    expect(screen.getByText("Historial de precios")).toBeInTheDocument();
    // El texto de cada fila está repartido en varios nodos (etiqueta,
    // precio y motivo): se asiste con regex.
    expect(screen.getByText(/Apertura \(P0\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ronda 1 — GP de Qatar/)).toBeInTheDocument();
    expect(screen.getByText(/\(manual\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(fórmula\)/)).toBeInTheDocument();
  });

  it("muestra el estado vacío del histórico", async () => {
    mockAssets([riderAsset]);
    mockHistory([]);
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");

    expect(screen.getByText("Este activo aún no tiene precios.")).toBeInTheDocument();
  });

  it("muestra el error al cargar el histórico", async () => {
    mockAssets([riderAsset]);
    mockResult(trpc.market.prices.history.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");

    expect(
      screen.getByText("No se pudo cargar el histórico: sin conexión"),
    ).toBeInTheDocument();
  });

  it("desactiva el botón mientras guarda", async () => {
    mockAssets([riderAsset]);
    mockResult(trpc.market.prices.setOpening.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");
    await user.type(screen.getByLabelText("Precio de apertura (P0)"), "25");

    expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled();
  });

  it("refresca la lista y el histórico tras fijar (onSuccess → refetch)", async () => {
    const assetsRefetch = vi.fn();
    mockAssets([riderAsset], assetsRefetch);
    const historyRefetch = vi.fn();
    mockHistory(historyRows, historyRefetch);
    const mutate = vi.fn();
    mockResult(trpc.market.prices.setOpening.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");
    await user.type(screen.getByLabelText("Precio de apertura (P0)"), "25");
    await user.click(screen.getByRole("button", { name: "Fijar P0" }));

    // `onSuccess` se pasa a `useMutation`; se captura y se invoca como en
    // el resto de tests de panel.
    const options = asMockFn(trpc.market.prices.setOpening.useMutation).mock
      .calls[0]?.[0] as { onSuccess?: () => void };
    options.onSuccess?.();

    expect(assetsRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("PricesPanel · P0 automático (heurística, ADR-0014)", () => {
  beforeEach(() => resetTrpcMocks());

  it("muestra la sección con el botón desactivado sin temporada", () => {
    mockSeasons([season]);
    render(<PricesPanel />);

    expect(screen.getByText("P0 automático (heurística de siembra)")).toBeInTheDocument();
    expect(screen.getByLabelText("Temporada (clasificación)")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Calcular P0 automático" }),
    ).toBeDisabled();
  });

  it("calcula el P0 automático al elegir temporada y pulsar el botón", async () => {
    mockSeasons([season]);
    const mutate = vi.fn();
    mockResult(trpc.market.market.p0Heuristic.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada (clasificación)"), "s1");
    expect(screen.getByRole("button", { name: "Calcular P0 automático" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Calcular P0 automático" }));

    expect(mutate).toHaveBeenCalledWith({ seasonId: "s1" });
  });

  it("muestra el resumen del P0 calculado", () => {
    mockResult(trpc.market.market.p0Heuristic.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        ridersPriced: 32,
        teamsPriced: 12,
        constructorsPriced: 5,
        minPrice: 10,
        maxPrice: 30,
      },
    });
    render(<PricesPanel />);

    expect(
      screen.getByText(/P0 calculado: 32 pilotos, 12 equipos, 5 constructores \(rango 10–30\)/),
    ).toBeInTheDocument();
  });

  it("muestra el error al no poder calcular el P0", () => {
    mockResult(trpc.market.market.p0Heuristic.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("La fuente no tiene clasificación."),
    });
    render(<PricesPanel />);

    expect(
      screen.getByText("No se pudo calcular el P0: La fuente no tiene clasificación."),
    ).toBeInTheDocument();
  });

  it("refresca la lista y el histórico tras calcular (onSuccess → refetch)", async () => {
    const assetsRefetch = vi.fn();
    mockAssets([riderAsset], assetsRefetch);
    const historyRefetch = vi.fn();
    mockHistory(historyRows, historyRefetch);
    mockSeasons([season]);
    mockResult(trpc.market.market.p0Heuristic.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada (clasificación)"), "s1");
    await user.click(screen.getByRole("button", { name: "Calcular P0 automático" }));

    const options =
      asMockFn(trpc.market.market.p0Heuristic.useMutation).mock.calls[0]?.[0] as {
        onSuccess?: () => void;
      };
    options.onSuccess?.();

    expect(assetsRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("PricesPanel · Precios por GP (US-08)", () => {
  beforeEach(() => resetTrpcMocks());

  it("muestra la sección con el selector de temporada (sin GPs hasta elegirla)", () => {
    render(<PricesPanel />);

    expect(
      screen.getByText("Precios por GP (fórmula v1 y ajuste manual)"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Temporada")).toHaveValue("");
    // Sin temporada: los selectores de GP solo tienen la opción vacía.
    const manualGp = screen.getByLabelText("GP (objetivo del precio manual)");
    expect(manualGp).toHaveValue("");
    expect(within(manualGp).queryAllByRole("option")).toHaveLength(1);
    expect(
      within(screen.getByLabelText("GP definitivo (fuente de la fórmula)")).queryAllByRole(
        "option",
      ),
    ).toHaveLength(1);
  });

  it("consulta los GPs de la temporada elegida y los lista con su estado", async () => {
    mockSeasons([season]);
    mockGps(gps);
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");

    const manualGp = screen.getByLabelText("GP (objetivo del precio manual)");
    expect(manualGp).toHaveValue("");
    expect(
      within(manualGp).getByText("Ronda 1 — GP de Qatar (finalizado)"),
    ).toBeInTheDocument();
    expect(
      within(manualGp).getByText("Ronda 2 — GP de Argentina (programado)"),
    ).toBeInTheDocument();
    // El selector de fórmula muestra las mismas opciones.
    expect(
      within(screen.getByLabelText("GP definitivo (fuente de la fórmula)")).getByText(
        "Ronda 2 — GP de Argentina (programado)",
      ),
    ).toBeInTheDocument();
  });

  it("al cambiar de temporada se resetean los selectores de GP", async () => {
    mockSeasons([season, { id: "s2", name: "MotoGP 2100", year: 2100 }]);
    mockGps(gps);
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
    await user.selectOptions(screen.getByLabelText("GP (objetivo del precio manual)"), "gp2");
    await user.selectOptions(screen.getByLabelText("Temporada"), "");

    expect(screen.getByLabelText("GP (objetivo del precio manual)")).toHaveValue("");
    expect(
      screen.getByLabelText("GP definitivo (fuente de la fórmula)"),
    ).toHaveValue("");
  });

  it("muestra el estado vacío y el error de la lista de GPs", async () => {
    mockSeasons([season]);
    mockGps([]);
    const { unmount } = render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
    expect(screen.getByText("Esta temporada aún no tiene GPs.")).toBeInTheDocument();
    unmount();

    mockResult(trpc.seasons.gps.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    render(<PricesPanel />);
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
    expect(
      screen.getByText("No se pudieron cargar los GPs: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra el estado de carga de la lista de GPs", async () => {
    mockAssets([riderAsset]);
    mockSeasons([season]);
    mockResult(trpc.seasons.gps.list.useQuery, {
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("fija un precio manual del activo elegido para un GP (setManual)", async () => {
    mockAssets([riderAsset]);
    mockSeasons([season]);
    mockGps(gps);
    const mutate = vi.fn();
    mockResult(trpc.market.prices.setManual.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");
    await pickSeasonAndGps(user);
    await user.type(screen.getByLabelText("Precio manual"), "5");
    await user.click(screen.getByRole("button", { name: "Fijar precio manual" }));

    expect(mutate).toHaveBeenCalledWith({
      assetType: "rider",
      assetId: "r1",
      gpId: "gp2",
      price: 5,
    });
  });

  it("desactiva el botón de precio manual hasta que hay activo, GP y precio", async () => {
    mockAssets([riderAsset]);
    mockSeasons([season]);
    mockGps(gps);
    render(<PricesPanel />);

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Fijar precio manual" });
    expect(button).toBeDisabled();

    // Activo + GP, pero sin precio: sigue desactivado.
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
    await user.selectOptions(screen.getByLabelText("GP (objetivo del precio manual)"), "gp2");
    expect(button).toBeDisabled();

    // Con precio: habilitado.
    await user.type(screen.getByLabelText("Precio manual"), "5");
    expect(button).toBeEnabled();
  });

  it("muestra el error al no poder fijar el precio manual", () => {
    mockResult(trpc.market.prices.setManual.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("No se pueden cambiar los precios de un GP en lockout."),
    });
    render(<PricesPanel />);

    expect(
      screen.getByText(
        "No se pudo fijar el precio manual: No se pueden cambiar los precios de un GP en lockout.",
      ),
    ).toBeInTheDocument();
  });

  it("confirma el precio manual creado, actualizado o sin cambios", () => {
    const cases: Array<[string, string]> = [
      ["created", "Precio manual creado."],
      ["updated", "Precio manual actualizado."],
      ["unchanged", "El precio ya era ese valor (sin cambios)."],
    ];
    for (const [status, message] of cases) {
      mockResult(trpc.market.prices.setManual.useMutation, {
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        isSuccess: true,
        data: { price: 5, status },
      });
      const { unmount } = render(<PricesPanel />);
      expect(screen.getByText(message)).toBeInTheDocument();
      unmount();
    }
  });

  it("aplica la fórmula al siguiente GP (applyFormula)", async () => {
    mockSeasons([season]);
    mockGps(gps);
    const mutate = vi.fn();
    mockResult(trpc.market.prices.applyFormula.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    const button = screen.getByRole("button", {
      name: "Aplicar fórmula al siguiente GP",
    });
    expect(button).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
    await user.selectOptions(screen.getByLabelText("GP definitivo (fuente de la fórmula)"), "gp1");
    expect(button).toBeEnabled();
    await user.click(button);

    expect(mutate).toHaveBeenCalledWith({ gpId: "gp1" });
  });

  it("muestra el resumen de la fórmula aplicada", () => {
    mockResult(trpc.market.prices.applyFormula.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        targetGpId: "gp2",
        targetGpRound: 2,
        created: 3,
        updated: 1,
        unchanged: 0,
        skippedNoOpening: 5,
        skippedLocked: false,
      },
    });
    render(<PricesPanel />);

    expect(
      screen.getByText(
        "Precios de la ronda 2 aplicados: 3 creados, 1 actualizados, 0 sin cambios, 5 sin P0.",
      ),
    ).toBeInTheDocument();
  });

  it("indica que no hay siguiente GP (último de la temporada)", () => {
    mockResult(trpc.market.prices.applyFormula.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        targetGpId: null,
        targetGpRound: null,
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedNoOpening: 0,
        skippedLocked: false,
      },
    });
    render(<PricesPanel />);

    expect(
      screen.getByText(
        "El GP elegido es el último de la temporada: no hay siguiente GP.",
      ),
    ).toBeInTheDocument();
  });

  it("indica que el GP objetivo está en lockout (precios sin cambios)", () => {
    mockResult(trpc.market.prices.applyFormula.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        targetGpId: "gp2",
        targetGpRound: 2,
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedNoOpening: 0,
        skippedLocked: true,
      },
    });
    render(<PricesPanel />);

    expect(
      screen.getByText(
        "El GP objetivo (ronda 2) está en lockout: precios sin cambios.",
      ),
    ).toBeInTheDocument();
  });

  it("muestra el error al no poder aplicar la fórmula", () => {
    mockResult(trpc.market.prices.applyFormula.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("El GP no tiene resultados definitivos."),
    });
    render(<PricesPanel />);

    expect(
      screen.getByText(
        "No se pudo aplicar la fórmula: El GP no tiene resultados definitivos.",
      ),
    ).toBeInTheDocument();
  });

  it("refresca el histórico tras fijar precio manual o aplicar la fórmula", async () => {
    mockAssets([riderAsset]);
    mockSeasons([season]);
    mockGps(gps);
    const historyRefetch = vi.fn();
    mockHistory(historyRows, historyRefetch);
    const mutateManual = vi.fn();
    mockResult(trpc.market.prices.setManual.useMutation, {
      mutate: mutateManual,
      isPending: false,
      isError: false,
    });
    const mutateFormula = vi.fn();
    mockResult(trpc.market.prices.applyFormula.useMutation, {
      mutate: mutateFormula,
      isPending: false,
      isError: false,
    });
    render(<PricesPanel />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Activo"), "r1");
    await pickSeasonAndGps(user);
    await user.type(screen.getByLabelText("Precio manual"), "5");
    await user.click(screen.getByRole("button", { name: "Fijar precio manual" }));
    await user.click(
      screen.getByRole("button", { name: "Aplicar fórmula al siguiente GP" }),
    );

    // `onSuccess` se captura de cada `useMutation` y se invoca manualmente.
    const manualOptions = asMockFn(trpc.market.prices.setManual.useMutation).mock
      .calls[0]?.[0] as { onSuccess?: () => void };
    manualOptions.onSuccess?.();
    const formulaOptions = asMockFn(trpc.market.prices.applyFormula.useMutation).mock
      .calls[0]?.[0] as { onSuccess?: () => void };
    formulaOptions.onSuccess?.();

    expect(historyRefetch).toHaveBeenCalledTimes(2);
  });
});
