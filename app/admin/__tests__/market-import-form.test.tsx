// @vitest-environment jsdom
/**
 * Tests de `app/admin/market-import-form.tsx` (US-06, ADR-0013): import de
 * mercado en 2 pasos (preview de solo lectura y luego import atómica con
 * afiliaciones por GP).
 */
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeasonWithRules } from "../../modules/seasons";
import type { NormalizedMarket } from "../../modules/market";
import { clientError } from "../../../test/errors";
import {
  asMockFn,
  mockResult,
  resetTrpcMocks,
  trpc,
  utilsMock,
} from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import MarketImportForm from "../market-import-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const season: SeasonWithRules = {
  id: "s1",
  name: "Temporada 2026",
  year: 2026,
  startDate: null,
  endDate: null,
  status: "planned",
  rules: [],
};

const market: NormalizedMarket = {
  year: 2026,
  seasonRef: "motogp-2026",
  source: { name: "PulseLive", version: "1.0" },
  constructors: [
    { sourceId: "c1", name: "Ducati" },
    { sourceId: "c2", name: "Aprilia" },
  ],
  teams: [
    {
      sourceId: "t1",
      name: "Ducati Lenovo Team",
      manufacturer: { sourceId: "c1", name: "Ducati" },
    },
    {
      sourceId: "t2",
      name: "Aprilia Racing",
      manufacturer: { sourceId: "c2", name: "Aprilia" },
    },
  ],
  riders: [
    { sourceId: "rider-source-id-1", name: "Marc", surname: "Marquez", number: 93, countryIso: "ES" },
    { sourceId: "rider-source-id-2", name: "Jorge", surname: "Martin", number: 89, countryIso: null },
  ],
  affiliations: [
    { riderSourceId: "rider-source-id-1", teamSourceId: "t1", seasonYear: 2026 },
    { riderSourceId: "rider-source-id-2", teamSourceId: "t2", seasonYear: 2026 },
  ],
};

function mockImport(result: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  mockResult(trpc.market.market.import.useMutation, {
    mutate,
    isPending: false,
    isError: false,
    ...result,
  });
  return mutate;
}

async function downloadMarket() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Año"), "2026");
  await user.click(screen.getByRole("button", { name: "1. Descargar mercado" }));
  return screen.findByText(/Mercado 2026/);
}

describe("MarketImportForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("desactiva la descarga con el año vacío", () => {
    mockImport();
    render(<MarketImportForm seasons={[season]} onImported={vi.fn()} />);
    expect(screen.getByRole("button", { name: "1. Descargar mercado" })).toBeDisabled();
  });

  it("no descarga con un año no numérico", async () => {
    mockImport();
    render(<MarketImportForm seasons={[season]} onImported={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Año"), { target: { value: "abc" } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "1. Descargar mercado" }));

    expect(utilsMock("market.market.fetch.fetch")).not.toHaveBeenCalled();
    expect(screen.queryByText(/Mercado \d+/)).not.toBeInTheDocument();
  });

  it("muestra el preview (constructores, equipos, pilotos, afiliaciones) y desactiva la import sin temporada", async () => {
    utilsMock("market.market.fetch.fetch").mockResolvedValue(market);
    mockImport();
    render(<MarketImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadMarket();

    expect(screen.getByText(/Mercado 2026/)).toHaveTextContent("fuente: PulseLive 1.0");
    expect(screen.getByText("Constructores (2)")).toBeInTheDocument();
    expect(screen.getByText("Ducati Lenovo Team")).toBeInTheDocument();
    expect(screen.getByText("Pilotos (2)")).toBeInTheDocument();
    expect(screen.getByText("Afiliaciones (2)")).toBeInTheDocument();
    // Pilotos (el nombre va en <strong>; dorsal/país en nodos adyacentes).
    expect(screen.getByText("Marc Marquez")).toBeInTheDocument();
    expect(screen.getByText("Jorge Martin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2. Importar mercado" })).toBeDisabled();
  });

  it("muestra el error cuando la fuente no responde", async () => {
    utilsMock("market.market.fetch.fetch").mockRejectedValue(
      new Error("fuente no disponible"),
    );
    mockImport();
    render(<MarketImportForm seasons={[season]} onImported={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Año"), "2026");
    await user.click(screen.getByRole("button", { name: "1. Descargar mercado" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("fuente no disponible");
  });

  it("importa el preview en la temporada elegida", async () => {
    utilsMock("market.market.fetch.fetch").mockResolvedValue(market);
    const mutate = mockImport();
    render(<MarketImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadMarket();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Importar en la temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "2. Importar mercado" }));
    expect(mutate).toHaveBeenCalledWith({ seasonId: "s1", market });
  });

  it("confirma la import listando creados/saltados (incluye afiliaciones)", async () => {
    utilsMock("market.market.fetch.fetch").mockResolvedValue(market);
    const onImported = vi.fn();
    mockImport({
      isSuccess: true,
      data: {
        seasonId: "s1",
        seasonYear: 2026,
        constructorsCreated: 2,
        constructorsSkipped: 0,
        teamsCreated: 2,
        teamsSkipped: 0,
        ridersCreated: 2,
        ridersSkipped: 0,
        affiliationsCreated: 4,
        affiliationsSkipped: 0,
      },
    });
    render(<MarketImportForm seasons={[season]} onImported={onImported} />);

    await downloadMarket();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Importar en la temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "2. Importar mercado" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "2 constructores creados, 0 saltados",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 afiliaciones creadas, 0 saltadas",
    );
    // `onSuccess` se pasa a `useMutation`; se invoca como en el resto de tests.
    const options =
      asMockFn(trpc.market.market.import.useMutation).mock.calls[0]?.[0] as {
        onSuccess?: () => void;
      };
    options.onSuccess?.();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("muestra el error general cuando falla la import", async () => {
    utilsMock("market.market.fetch.fetch").mockResolvedValue(market);
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockImport({ isError: true, error });
    render(<MarketImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadMarket();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Importar en la temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "2. Importar mercado" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });

  it("con errores de validación Zod no muestra el error general (issues por campo)", async () => {
    utilsMock("market.market.fetch.fetch").mockResolvedValue(market);
    const error = clientError("Error de validación", {
      code: "BAD_REQUEST",
      message: "Error de validación",
      zod: [{ path: ["market", "year"], message: "El año no es válido" }],
    });
    mockImport({ isError: true, error });
    render(<MarketImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadMarket();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Importar en la temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "2. Importar mercado" }));

    // Con issues Zod, `generalError` es null → no se muestra el alert general.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
