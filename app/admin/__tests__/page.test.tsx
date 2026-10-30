// @vitest-environment jsdom
/**
 * Tests de `app/admin/page.tsx` (T-24, fase C): panel de administración
 * (control de acceso por rol, listas de temporadas/circuitos, estados
 * vacíos y de error).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CircuitView, SeasonWithRules } from "../../modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import AdminPage from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/link", () => import("../../../test/ui-mocks").then((m) => m.linkMock));
// El import de calendario (2 pasos, ADR-0012) se cubre en su propio test
// file (`calendar-import-form.test.tsx`): aquí solo interesa el callback
// `onImported` (refrescar temporadas + circuitos).
vi.mock("../calendar-import-form", () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button type="button" onClick={onImported}>
      importar calendario
    </button>
  ),
}));
// El import de mercado (2 pasos, ADR-0013) se cubre en su propio test file
// (`market-import-form.test.tsx`): aquí solo interesa el callback `onImported`
// (refrescar temporadas).
vi.mock("../market-import-form", () => ({
  default: ({ onImported }: { onImported: () => void }) => (
    <button type="button" onClick={onImported}>
      importar mercado
    </button>
  ),
}));

const admin = {
  username: "admin1",
  email: "admin@liga.com",
  roles: ["global_admin"],
};
const plainUser = {
  username: "piloto1",
  email: "piloto@liga.com",
  roles: ["user"],
};

function mockMe(data: unknown) {
  mockResult(trpc.auth.me.useQuery, {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
}

function mockList(hook: unknown, data: unknown) {
  mockResult(hook, {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
}

describe("AdminPage", () => {
  beforeEach(() => resetTrpcMocks());

  it("muestra el estado de carga mientras consulta la sesión", () => {
    render(<AdminPage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("pide iniciar sesión cuando la sesión falla", () => {
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("no"),
      refetch: vi.fn(),
    });
    render(<AdminPage />);
    expect(
      screen.getByText("Necesitas iniciar sesión para acceder al panel."),
    ).toBeInTheDocument();
  });

  it("rechaza a un usuario sin el rol de administrador global", () => {
    mockMe(plainUser);
    render(<AdminPage />);
    expect(
      screen.getByText("Solo el administrador global puede acceder a este panel."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Temporadas" })).not.toBeInTheDocument();
  });

  it("muestra los estados vacíos y los formularios para un admin", () => {
    mockMe(admin);
    mockList(trpc.seasons.list.useQuery, []);
    mockList(trpc.seasons.circuits.list.useQuery, []);
    render(<AdminPage />);

    expect(
      screen.getByText("Aún no hay temporadas. Crea la primera abajo."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Aún no hay circuitos. Crea el primero abajo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Crear temporada" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "GPs" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Importar calendario" }),
    ).toBeInTheDocument();
  });

  it("lista las temporadas con sus reglas y los circuitos", () => {
    const seasons: SeasonWithRules[] = [
      {
        id: "s1",
        name: "Temporada 2026",
        year: 2026,
        startDate: null,
        endDate: null,
        status: "active",
        rules: [
          {
            id: "r1",
            version: "provisional-v1",
            rules: PROVISIONAL_SEASON_RULES,
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      },
    ];
    const circuits: CircuitView[] = [
      {
        id: "c1",
        name: "Circuito de Jerez",
        country: "España",
        location: "Jerez de la Frontera",
      },
    ];
    mockMe(admin);
    mockList(trpc.seasons.list.useQuery, seasons);
    mockList(trpc.seasons.circuits.list.useQuery, circuits);
    render(<AdminPage />);

    expect(screen.getByText("Temporada 2026")).toBeInTheDocument();
    expect(screen.getByText(/estado: activa/)).toBeInTheDocument();
    expect(screen.getByText("provisional-v1")).toBeInTheDocument();
    expect(screen.getByText("Circuito de Jerez")).toBeInTheDocument();
    expect(screen.getByText(/Jerez de la Frontera/)).toBeInTheDocument();
  });

  it("muestra el error cuando no se cargan las temporadas", () => {
    mockMe(admin);
    mockResult(trpc.seasons.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    mockList(trpc.seasons.circuits.list.useQuery, []);
    render(<AdminPage />);

    expect(
      screen.getByText("No se pudieron cargar las temporadas: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra el error cuando no se cargan los circuitos", () => {
    mockMe(admin);
    mockList(trpc.seasons.list.useQuery, []);
    mockResult(trpc.seasons.circuits.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    render(<AdminPage />);

    expect(
      screen.getByText("No se pudieron cargar los circuitos: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra 'Consultando…' mientras carga las temporadas", () => {
    mockMe(admin);
    mockResult(trpc.seasons.list.useQuery, {
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    });
    mockList(trpc.seasons.circuits.list.useQuery, []);
    // El mercado (US-06/US-07) también carga: se deja resuelto para que solo
    // la query de temporadas esté pendiente.
    mockList(trpc.market.riders.list.useQuery, []);
    mockList(trpc.market.constructors.list.useQuery, []);
    mockList(trpc.market.teams.list.useQuery, []);
    mockList(trpc.market.prices.list.useQuery, []);
    render(<AdminPage />);

    expect(screen.getAllByText("Consultando…")).toHaveLength(1);
  });

  it("muestra 'Consultando…' mientras carga los circuitos", () => {
    mockMe(admin);
    mockList(trpc.seasons.list.useQuery, []);
    mockResult(trpc.seasons.circuits.list.useQuery, {
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    });
    // El mercado (US-06/US-07) también carga: se deja resuelto para que solo
    // la query de circuitos esté pendiente.
    mockList(trpc.market.riders.list.useQuery, []);
    mockList(trpc.market.constructors.list.useQuery, []);
    mockList(trpc.market.teams.list.useQuery, []);
    mockList(trpc.market.prices.list.useQuery, []);
    render(<AdminPage />);

    expect(screen.getAllByText("Consultando…")).toHaveLength(1);
  });

  it("refresca temporadas y circuitos al importar el calendario", async () => {
    mockMe(admin);
    const seasonsRefetch = vi.fn();
    const circuitsRefetch = vi.fn();
    mockResult(trpc.seasons.list.useQuery, {
      data: [],
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: seasonsRefetch,
    });
    mockResult(trpc.seasons.circuits.list.useQuery, {
      data: [],
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: circuitsRefetch,
    });
    render(<AdminPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "importar calendario" }));

    expect(seasonsRefetch).toHaveBeenCalledTimes(1);
    expect(circuitsRefetch).toHaveBeenCalledTimes(1);
  });

  it("refresca temporadas al importar el mercado", async () => {
    mockMe(admin);
    const seasonsRefetch = vi.fn();
    mockResult(trpc.seasons.list.useQuery, {
      data: [],
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: seasonsRefetch,
    });
    mockList(trpc.seasons.circuits.list.useQuery, []);
    mockList(trpc.market.riders.list.useQuery, []);
    mockList(trpc.market.constructors.list.useQuery, []);
    mockList(trpc.market.teams.list.useQuery, []);
    mockList(trpc.market.prices.list.useQuery, []);
    render(<AdminPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "importar mercado" }));

    expect(seasonsRefetch).toHaveBeenCalledTimes(1);
  });
});
