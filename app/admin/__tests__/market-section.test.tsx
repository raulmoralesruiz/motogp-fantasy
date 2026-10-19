// @vitest-environment jsdom
/**
 * Tests de `app/admin/market-section.tsx` (US-06): sección de mercado
 * (listas de pilotos/constructores/equipos con estados de carga, error y
 * vacío, y refresco de las tres listas al crear un activo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeasonWithRules } from "../../modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { asMockFn, mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent, within } from "../../../test/rtl";

import MarketSection from "../market-section";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const season: SeasonWithRules = {
  id: "s1",
  name: "Temporada 2026",
  year: 2026,
  startDate: null,
  endDate: null,
  status: "planned",
  rules: [
    {
      id: "r1",
      version: "provisional-v1",
      rules: PROVISIONAL_SEASON_RULES,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ],
};

const rider = { id: "r1", name: "Francesco Bagnaia", number: 27, isActive: true };
const inactiveRider = { id: "r2", name: "Piloto Fuera", number: null, isActive: false };
const constructor = { id: "c1", name: "Ducati" };
const team = {
  id: "t1",
  name: "Ducati Lenovo Team",
  constructorId: "c1",
  constructorName: "Ducati",
};

function mockList(hook: unknown, data: unknown, refetch: ReturnType<typeof vi.fn> = vi.fn()) {
  mockResult(hook, {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch,
  });
}

describe("MarketSection", () => {
  beforeEach(() => resetTrpcMocks());

  it("muestra los pilotos, constructores y equipos cargados", () => {
    mockList(trpc.market.riders.list.useQuery, [rider, inactiveRider]);
    mockList(trpc.market.constructors.list.useQuery, [constructor]);
    mockList(trpc.market.teams.list.useQuery, [team]);
    const { container } = render(<MarketSection seasons={[season]} />);

    // El nombre de cada piloto también aparece en el select del panel de
    // afiliaciones: se acota la búsqueda a cada lista.
    const riderList = container.querySelector("ul.status") as HTMLElement;
    const constructorList = container.querySelectorAll("ul.status")[1] as HTMLElement;
    const teamList = container.querySelectorAll("ul.status")[2] as HTMLElement;

    expect(within(riderList).getByText("Francesco Bagnaia")).toBeInTheDocument();
    expect(within(riderList).getByText("(#27)")).toBeInTheDocument();
    expect(within(riderList).getByText("Piloto Fuera")).toBeInTheDocument();
    expect(within(riderList).getByText("— inactivo")).toBeInTheDocument();
    expect(within(constructorList).getByText("Ducati")).toBeInTheDocument();
    expect(within(teamList).getByText("Ducati Lenovo Team")).toBeInTheDocument();
    expect(within(teamList).getByText("— constructor: Ducati")).toBeInTheDocument();
  });

  it("muestra el estado de carga mientras consulta", () => {
    render(<MarketSection seasons={[season]} />);
    // 3 listas (pilotos/constructores/equipos) + la lista de activos del
    // panel de precios (US-07).
    expect(screen.getAllByText("Consultando…")).toHaveLength(4);
  });

  it("muestra el error cuando no se pueden cargar los pilotos", () => {
    mockResult(trpc.market.riders.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    mockList(trpc.market.constructors.list.useQuery, []);
    mockList(trpc.market.teams.list.useQuery, []);
    render(<MarketSection seasons={[season]} />);

    expect(
      screen.getByText("No se pudieron cargar los pilotos: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra el error cuando no se pueden cargar los constructores", () => {
    mockList(trpc.market.riders.list.useQuery, []);
    mockResult(trpc.market.constructors.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    mockList(trpc.market.teams.list.useQuery, []);
    render(<MarketSection seasons={[season]} />);

    expect(
      screen.getByText("No se pudieron cargar los constructores: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra el error cuando no se pueden cargar los equipos", () => {
    mockList(trpc.market.riders.list.useQuery, []);
    mockList(trpc.market.constructors.list.useQuery, []);
    mockResult(trpc.market.teams.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    render(<MarketSection seasons={[season]} />);

    expect(
      screen.getByText("No se pudieron cargar los equipos: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando aún no hay activos", () => {
    mockList(trpc.market.riders.list.useQuery, []);
    mockList(trpc.market.constructors.list.useQuery, []);
    mockList(trpc.market.teams.list.useQuery, []);
    render(<MarketSection seasons={[season]} />);

    expect(screen.getByText("Aún no hay pilotos. Crea el primero abajo.")).toBeInTheDocument();
    expect(screen.getByText("Aún no hay constructores. Crea el primero abajo.")).toBeInTheDocument();
    expect(screen.getByText("Aún no hay equipos. Crea el primero abajo.")).toBeInTheDocument();
  });

  it("refresca las tres listas al crear un activo (onCreated → refetchAll)", async () => {
    const ridersRefetch = vi.fn();
    const constructorsRefetch = vi.fn();
    const teamsRefetch = vi.fn();
    mockList(trpc.market.riders.list.useQuery, [rider], ridersRefetch);
    mockList(trpc.market.constructors.list.useQuery, [constructor], constructorsRefetch);
    mockList(trpc.market.teams.list.useQuery, [team], teamsRefetch);
    const { container } = render(<MarketSection seasons={[season]} />);

    const user = userEvent.setup();
    // Primer formulario (piloto): rellena y envía.
    const riderForm = container.querySelectorAll("form")[0] as HTMLElement;
    await user.type(within(riderForm).getByLabelText("Nombre"), "Francesco Bagnaia");
    await user.click(within(riderForm).getByRole("button", { name: "Crear piloto" }));

    // El formulario llamó a mutate; se invoca el onSuccess capturado
    // (equivalente a la respuesta exitosa del servidor).
    const options = asMockFn(trpc.market.riders.create.useMutation).mock.calls[0]?.[0] as {
      onSuccess?: () => void;
    };
    options.onSuccess?.();

    expect(ridersRefetch).toHaveBeenCalledTimes(1);
    expect(constructorsRefetch).toHaveBeenCalledTimes(1);
    expect(teamsRefetch).toHaveBeenCalledTimes(1);
  });
});
