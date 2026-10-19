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
