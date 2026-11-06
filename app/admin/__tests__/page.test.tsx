// @vitest-environment jsdom
/**
 * Tests de `app/admin/page.tsx` (T-24, fase C): panel de administración
 * (control de acceso por rol, listas de temporadas/circuitos, estados
 * vacíos y de error).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CircuitView,
  GpView,
  SeasonWithRules,
} from "../../modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent, within } from "../../../test/rtl";

import AdminPage from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/link", () => import("../../../test/ui-mocks").then((m) => m.linkMock));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);
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

/**
 * Sección "Jobs y fuentes" (T-14): se deja resuelta para que sus
 * 'Consultando…' no contamine los tests que cuentan elementos de carga.
 */
function mockJobsStatus() {
  mockResult(trpc.admin.jobsStatus.useQuery, {
    data: { queues: [], activeAlerts: [], probe: null, sentryEnabled: false },
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

  it("explica el vocabulario de las reglas (JSON) en su primera aparición", () => {
    mockMe(admin);
    mockList(trpc.seasons.list.useQuery, []);
    mockList(trpc.seasons.circuits.list.useQuery, []);
    render(<AdminPage />);

    // impeccable P1: B/t/cmax (carry) y pmaxRider/pmaxGroup (Pmax) solo
    // existen en el JSON de los formularios de reglas; se explican una vez
    // en el detalle «Altas y configuración de temporadas», en la primera
    // aparición, con la fuente de verdad de reglas (docs/product/).
    const help = screen.getByText(/Reglas \(JSON\): presupuesto por GP/);
    expect(help).toBeInTheDocument();
    expect(help).toHaveTextContent(/carry limitado \(t × sin usar, tope cmax\)/);
    expect(help).toHaveTextContent(/pmaxRider\/pmaxGroup/);
    expect(help).toHaveTextContent(/docs\/product\/economy\.md/);
    expect(help).toHaveTextContent(/docs\/product\/scoring\.md/);
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
    mockJobsStatus(); // T-14: también carga; solo la de temporadas pendiente
    // P1-1: la actividad de la consola también carga; resuelta (vacía)
    // para que solo la query de temporadas esté pendiente.
    mockResult(trpc.seasons.activity.useQuery, {
      data: [],
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
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
    mockJobsStatus(); // T-14: también carga; solo la de circuitos pendiente
    // P1-1: la actividad de la consola también carga; resuelta (vacía)
    // para que solo la query de circuitos esté pendiente.
    mockResult(trpc.seasons.activity.useQuery, {
      data: [],
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
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

/**
 * Consola del fin de semana de carrera (sección `#fin-de-semana` del panel):
 * el último GP disputado de la temporada más reciente y el siguiente paso
 * del ritual de resultados, con sus estados de carga, de error y por
 * resultado (cerrado / sin resultados / provisionales).
 */
describe("Consola del fin de semana de carrera", () => {
  beforeEach(() => resetTrpcMocks());

  const season: SeasonWithRules = {
    id: "s2026",
    name: "Temporada 2026",
    year: 2026,
    startDate: null,
    endDate: null,
    status: "active",
    rules: [],
  };

  const circuit: CircuitView = {
    id: "c1",
    name: "Circuito de Le Mans",
    country: "Francia",
    location: null,
  };

  /** GP ya disputado (fecha pasada) — el candidato del fin de semana. */
  const pastGp: GpView = {
    id: "gp-francia",
    seasonId: season.id,
    round: 3,
    name: "GP de Francia",
    circuit,
    date: new Date("2026-05-02T14:00:00Z"),
    status: "finished",
    lockoutAt: null,
    sourceRef: null,
    events: [],
  };

  function baseMocks() {
    mockMe(admin);
    mockList(trpc.seasons.list.useQuery, [season]);
    mockList(trpc.seasons.circuits.list.useQuery, []);
    mockList(trpc.market.riders.list.useQuery, []);
    mockList(trpc.market.constructors.list.useQuery, []);
    mockList(trpc.market.teams.list.useQuery, []);
    mockList(trpc.market.prices.list.useQuery, []);
    // Por defecto la temporada de la fixture está ABIERTA (2 GPs sin
    // cerrar): los tests del ritual de resultados mantienen su contexto.
    mockActivity([
      {
        seasonId: season.id,
        name: season.name,
        year: season.year,
        totalGps: 5,
        openGps: 2,
      },
    ]);
    mockJobsStatus();
  }

  function mockActivity(
    data: Array<{
      seasonId: string;
      name: string;
      year: number;
      totalGps: number;
      openGps: number;
    }>,
    extra: Record<string, unknown> = {},
  ) {
    mockResult(trpc.seasons.activity.useQuery, {
      data,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
      ...extra,
    });
  }

  function mockGps(data: GpView[], extra: Record<string, unknown> = {}) {
    mockResult(trpc.seasons.gps.list.useQuery, {
      data,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
      ...extra,
    });
  }

  function mockGpState(
    overrides: Record<string, unknown> & { data?: Record<string, unknown> } =
      {},
  ) {
    mockResult(trpc.results.gpState.useQuery, {
      data: {
        gpId: pastGp.id,
        gpName: pastGp.name,
        round: pastGp.round,
        seasonName: season.name,
        definitive: false,
        resultsVersion: null,
        counts: { provisional: 0, definitive: 0, corrected: 0 },
        totalResults: 0,
        lineups: 0,
        ...overrides.data,
      },
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
      ...overrides,
    });
  }

  function consoleScope() {
    return within(document.getElementById("fin-de-semana") as HTMLElement);
  }

  it("muestra 'Consultando…' mientras carga la lista de GPs", () => {
    baseMocks();
    // `seasons.gps.list` se deja pendiente (default del mock).
    mockGps([], { isPending: true, isSuccess: false, isError: false });
    render(<AdminPage />);

    expect(consoleScope().getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error si la lista de GPs falla", () => {
    baseMocks();
    mockGps(
      [],
      {
        isPending: false,
        isError: true,
        isSuccess: false,
        data: undefined,
        error: new Error("sin conexión"),
      },
    );
    render(<AdminPage />);

    expect(
      consoleScope().getByText("No se pudieron cargar los GPs: sin conexión"),
    ).toBeInTheDocument();
  });

  it("avisa que aún no hay GPs disputados cuando la lista está vacía", () => {
    baseMocks();
    mockGps([]);
    render(<AdminPage />);

    expect(
      consoleScope().getByText(/Temporada 2026 aún no tiene GPs disputados/),
    ).toBeInTheDocument();
  });

  it("ignora GPs cancelados y GPs con fecha futura", () => {
    baseMocks();
    mockGps([
      { ...pastGp, status: "cancelled" },
      { ...pastGp, id: "gp-futuro", date: new Date("2027-05-02T14:00:00Z") },
    ]);
    render(<AdminPage />);

    expect(
      consoleScope().getByText(/Temporada 2026 aún no tiene GPs disputados/),
    ).toBeInTheDocument();
  });

  it("muestra 'Consultando…' mientras carga el estado del GP", () => {
    baseMocks();
    mockGps([pastGp]);
    // `results.gpState` se deja pendiente (default del mock).
    render(<AdminPage />);

    expect(consoleScope().getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error si el estado del GP falla", () => {
    baseMocks();
    mockGps([pastGp]);
    mockGpState({
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
    });
    render(<AdminPage />);

    expect(
      consoleScope().getByText("No se pudo cargar el estado del GP: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra un GP cerrado con su versión de resultados y el paso siguiente", () => {
    baseMocks();
    mockGps([pastGp]);
    mockGpState({
      data: {
        definitive: true,
        resultsVersion: "rv-2026-05-02",
        counts: { provisional: 0, definitive: 12, corrected: 0 },
        totalResults: 12,
        lineups: 3,
      },
    });
    render(<AdminPage />);

    const scope = consoleScope();
    expect(scope.getByText("R3 · GP de Francia")).toBeInTheDocument();
    expect(
      scope.getByText(/cerrado \(rv-2026-05-02\), los lineups ya puntúan/),
    ).toBeInTheDocument();
    expect(
      scope.getByText(/revisa los precios del próximo GP en el paso 3 del panel de Precios\./),
    ).toBeInTheDocument();
    // Con el GP cerrado la CTA apunta al panel de Precios (paso 3).
    expect(scope.getByRole("link", { name: "Ir a Precios" })).toHaveAttribute(
      "href",
      "#precios",
    );
    // Vocabulario (impeccable P1): rv-N se define en su primera aparición.
    expect(
      scope.getByText(/rv-N = versión de resultados del GP/),
    ).toBeInTheDocument();
  });

  it("muestra un GP cerrado sin versión de resultados", () => {
    baseMocks();
    mockGps([pastGp]);
    mockGpState({
      data: {
        definitive: true,
        resultsVersion: null,
        counts: { provisional: 0, definitive: 12, corrected: 0 },
        totalResults: 12,
        lineups: 3,
      },
    });
    render(<AdminPage />);

    const scope = consoleScope();
    expect(
      scope.getByText(/cerrado, los lineups ya puntúa/),
    ).toBeInTheDocument();
  });

  it("muestra un GP sin resultados importados y su paso siguiente", () => {
    baseMocks();
    mockGps([pastGp]);
    mockGpState({
      data: {
        definitive: false,
        resultsVersion: null,
        counts: { provisional: 0, definitive: 0, corrected: 0 },
        totalResults: 0,
        lineups: 3,
      },
    });
    render(<AdminPage />);

    const scope = consoleScope();
    expect(scope.getByText(/sin resultados importados/)).toBeInTheDocument();
    expect(
      scope.getByText(/importa los resultados en el paso 1 del ritual de Resultados\./),
    ).toBeInTheDocument();
    // La CTA lleva el contexto del ritual (?season=&gp=) para que al
    // navegar la cascada esté prellenada (adapt).
    expect(scope.getByRole("link", { name: "Ir a Resultados" })).toHaveAttribute(
      "href",
      `/admin?season=${season.id}&gp=${pastGp.id}#resultados`,
    );
  });

  it("muestra resultados provisionales y pide marcarlos definitivos", () => {
    baseMocks();
    mockGps([pastGp]);
    mockGpState({
      data: {
        definitive: false,
        resultsVersion: "rv-2026-05-01",
        counts: { provisional: 11, definitive: 0, corrected: 1 },
        totalResults: 12,
        lineups: 3,
      },
    });
    render(<AdminPage />);

    const scope = consoleScope();
    expect(
      scope.getByText(/resultados provisionales \(11 provisional\(es\), 1 corregida\(s\)\)/),
    ).toBeInTheDocument();
    expect(
      scope.getByText(/revísalos y márcalos definitivos en el paso 3 del ritual de Resultados\./),
    ).toBeInTheDocument();
    expect(scope.getByRole("link", { name: "Ir a Resultados" })).toHaveAttribute(
      "href",
      `/admin?season=${season.id}&gp=${pastGp.id}#resultados`,
    );
  });

  it("indica cuántos GPs hay sin cerrar en la temporada abierta (contexto de la consola)", () => {
    baseMocks();
    mockGps([pastGp]);
    mockGpState({
      data: {
        definitive: true,
        resultsVersion: "rv-2026-05-02",
        counts: { provisional: 0, definitive: 12, corrected: 0 },
        totalResults: 12,
        lineups: 3,
      },
    });
    render(<AdminPage />);

    const scope = consoleScope();
    expect(scope.getByText("Temporada 2026")).toBeInTheDocument();
    // El nombre va en `<strong>` (hijo del <p>): el texto directo del
    // párrafo es " — 2 GPs sin cerrar de 5."
    expect(scope.getByText(/2 GPs sin cerrar de 5\./)).toBeInTheDocument();
  });

  it("usa el singular cuando solo hay un GP sin cerrar", () => {
    baseMocks();
    mockActivity([
      {
        seasonId: season.id,
        name: season.name,
        year: season.year,
        totalGps: 3,
        openGps: 1,
      },
    ]);
    render(<AdminPage />);

    expect(
      consoleScope().getByText(/1 GP sin cerrar de 3\./),
    ).toBeInTheDocument();
  });

  it("muestra la temporada cerrada (sin GPs sin cerrar) con su salida", () => {
    baseMocks();
    mockActivity([
      { seasonId: season.id, name: season.name, year: season.year, totalGps: 4, openGps: 0 },
    ]);
    render(<AdminPage />);

    const scope = consoleScope();
    expect(scope.getByText(/está cerrada/)).toBeInTheDocument();
    // El párrafo intercala los enlaces (texto directo: "Siguiente paso:  o .").
    expect(scope.getByText(/Siguiente paso:/)).toBeInTheDocument();
    // La salida apunta a las secciones de temporada y calendario.
    expect(scope.getByRole("link", { name: "crea la próxima temporada" })).toHaveAttribute(
      "href",
      "#temporadas",
    );
    expect(scope.getByRole("link", { name: "importa su calendario" })).toHaveAttribute(
      "href",
      "#calendario",
    );
  });

  it("prefiere la temporada abierta aunque otra más reciente esté cerrada", () => {
    baseMocks();
    mockActivity([
      { seasonId: "s2105", name: "Temporada 2105", year: 2105, totalGps: 6, openGps: 0 },
      { seasonId: season.id, name: season.name, year: season.year, totalGps: 5, openGps: 2 },
    ]);
    mockGps([pastGp]);
    mockGpState({
      data: {
        definitive: false,
        totalResults: 0,
      },
    });
    render(<AdminPage />);

    // Opera sobre la temporada 2026 (abierta), no sobre la 2105 (cerrada).
    const scope = consoleScope();
    expect(scope.getByText("Temporada 2026")).toBeInTheDocument();
    expect(scope.queryByText(/está cerrada/)).not.toBeInTheDocument();
  });

  it("muestra el estado vacío (sin GPs en ninguna temporada) con sus salidas", () => {
    baseMocks();
    mockActivity([
      { seasonId: "s2105", name: "Temporada 2105", year: 2105, totalGps: 0, openGps: 0 },
    ]);
    render(<AdminPage />);

    const scope = consoleScope();
    expect(
      scope.getByText(/Todavía no hay GPs en ninguna temporada/),
    ).toBeInTheDocument();
    // El párrafo intercala los enlaces (texto directo: "Siguiente paso: ,  o .").
    expect(scope.getByText(/Siguiente paso:/)).toBeInTheDocument();
    expect(scope.getByRole("link", { name: "crea la primera temporada" })).toHaveAttribute(
      "href",
      "#temporadas",
    );
    expect(scope.getByRole("link", { name: "añade sus GPs" })).toHaveAttribute(
      "href",
      "#gps",
    );
    expect(scope.getByRole("link", { name: "importa el calendario" })).toHaveAttribute(
      "href",
      "#calendario",
    );
  });

  it("muestra 'Consultando…' mientras carga la actividad de temporadas", () => {
    baseMocks();
    mockActivity([], { isPending: true, isSuccess: false, isError: false, data: undefined });
    render(<AdminPage />);

    expect(consoleScope().getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error si la actividad de temporadas falla", () => {
    baseMocks();
    mockActivity(
      [],
      {
        data: undefined,
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error("sin conexión"),
      },
    );
    render(<AdminPage />);

    expect(
      consoleScope().getByText("No se pudo cargar la actividad de temporadas: sin conexión"),
    ).toBeInTheDocument();
  });
});
