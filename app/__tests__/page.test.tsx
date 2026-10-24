// @vitest-environment jsdom
/**
 * Tests de la home (`app/page.tsx`):
 * - T-24, fase C: estado del sistema (health) y sesión (me/logout).
 * - US-15: dashboard (próximo GP con cuenta atrás a lockout, presupuesto,
 *   coste del lineup, posición en cada liga y avisos).
 *
 * Todo sobre el `trpc` mockeado.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asMockFn, mockResult, resetTrpcMocks, trpc } from "../../test/trpc-mock";
import { navigation, resetNavigationMocks } from "../../test/ui-mocks";
import { act, render, screen, userEvent, within } from "../../test/rtl";

import HomePage from "../page";

vi.mock("@/trpc/client", () => import("../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../test/ui-mocks").then((m) => m.navigationMock),
);
vi.mock("next/link", () => import("../../test/ui-mocks").then((m) => m.linkMock));

function renderHome(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const healthOk = {
  status: "ok",
  app: { name: "fantasy-motogp", version: "0.1.0", fase: "Fase 1 (E2)" },
  database: { ok: true },
  redis: { ok: true },
  comprobadoEn: "2026-10-18T10:00:00.000Z",
};

describe("HomePage", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("muestra el estado del sistema y la sesión pendientes", () => {
    renderHome(<HomePage />);
    expect(screen.getAllByText("Consultando…")).toHaveLength(2);
  });

  it("muestra el sistema operativo con dependencias conectadas", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("sin sesión"),
    });
    renderHome(<HomePage />);
    expect(screen.getByText("operativa")).toBeInTheDocument();
    expect(screen.getByText("conectada")).toBeInTheDocument();
    expect(screen.getByText("conectado")).toBeInTheDocument();
  });

  it("muestra el sistema degradado cuando una dependencia falla", () => {
    mockResult(trpc.health.check.useQuery, {
      data: { ...healthOk, status: "degradada", database: { ok: false } },
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("sin sesión"),
    });
    renderHome(<HomePage />);
    expect(screen.getByText("degradada")).toBeInTheDocument();
    expect(screen.getByText("sin conexión")).toBeInTheDocument();
  });

  it("muestra el error si no se pudo consultar el estado", () => {
    mockResult(trpc.health.check.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("timeout de red"),
    });
    renderHome(<HomePage />);
    expect(
      screen.getByText(/No se pudo consultar el estado: timeout de red/),
    ).toBeInTheDocument();
  });

  it("ofrece iniciar sesión o registrarse cuando no hay sesión", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("sin sesión"),
    });
    renderHome(<HomePage />);
    expect(screen.getByText(/No has iniciado sesión/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "crea una cuenta" })).toHaveAttribute(
      "href",
      "/registro",
    );
  });

  it("muestra la sesión activa de un usuario sin roles", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: { username: "piloto1", email: "piloto@liga.com", roles: [] },
      isPending: false,
      isError: false,
    });
    renderHome(<HomePage />);
    expect(screen.getByText("Sesión activa: (piloto@liga.com)")).toBeInTheDocument();
    expect(screen.getByText("piloto1")).toBeInTheDocument();
    expect(screen.queryByText(/roles:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Panel de administración" }),
    ).not.toBeInTheDocument();
  });

  it("muestra roles y el enlace al panel para global_admin", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: { username: "admin1", email: "admin@liga.com", roles: ["global_admin"] },
      isPending: false,
      isError: false,
    });
    renderHome(<HomePage />);
    expect(screen.getByText(/roles: global_admin/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Panel de administración" })).toHaveAttribute(
      "href",
      "/admin",
    );
  });

  it("cierra la sesión y refresca la página al confirmarse", async () => {
    const mutate = vi.fn();
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: { username: "piloto1", email: "piloto@liga.com", roles: [] },
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.logout.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderHome(<HomePage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(mutate).toHaveBeenCalledTimes(1);

    const options = asMockFn(trpc.auth.logout.useMutation).mock.calls[0]?.[0] as {
      onSuccess?: () => void;
    };
    await act(async () => {
      options.onSuccess?.();
    });
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });
});

// ── Dashboard (US-15) ────────────────────────────────────────────────────────

/** Próximo GP de referencia (con lockout futuro). */
const nextGp = {
  id: "gp-1",
  name: "GP de España",
  round: 3,
  date: new Date("2026-06-01T12:00:00Z"),
  status: "scheduled",
  lockoutAt: new Date("2026-06-01T14:30:00Z"),
  circuit: { name: "Circuito de Jerez", country: "España" },
  closed: false,
};

/** Vista de dashboard de referencia (todo poblado). */
const dashboardOk = {
  season: { id: "season-1", name: "Temporada 2026", year: 2026 },
  nextGp,
  budget: { base: 100, carry: 5, total: 105 },
  lineup: {
    gpId: "gp-1",
    cost: 95,
    budget: 105,
    balance: 10,
    slots: {
      gold: ["r1", "r2"],
      silver: ["r3", "r4"],
      constructorId: "c1",
      teamId: "t1",
    },
    usedChanges: 0,
    remainingChanges: 2,
    updatedAt: new Date("2026-05-20T10:00:00Z"),
  },
  leagues: [
    {
      leagueId: "l1",
      leagueName: "Liga A",
      gpPosition: 2,
      gpPoints: 150.5,
      overallPosition: 3,
      overallPoints: 800.25,
    },
  ],
  notices: [] as {
    kind: string;
    severity: "error" | "warning" | "info";
    message: string;
    gpId: string;
    gpName: string;
    at: Date | null;
  }[],
};

/** Renderiza la home con sesión activa + health OK + dashboard dado. */
function renderDashboard(dashboardData: Record<string, unknown>) {
  mockResult(trpc.auth.me.useQuery, {
    data: { username: "piloto1", email: "piloto@liga.com", roles: [] },
    isPending: false,
    isError: false,
  });
  mockResult(trpc.health.check.useQuery, {
    data: healthOk,
    isPending: false,
    isError: false,
  });
  mockResult(trpc.dashboard.get.useQuery, {
    data: dashboardData,
    isPending: false,
    isError: false,
  });
  renderHome(<HomePage />);
}

/** Acota a la tarjeta cuya cabecera es `heading`. */
function card(heading: string) {
  return within(screen.getByText(heading).closest(".card") as HTMLElement);
}

describe("Dashboard (US-15)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("pendiente: muestra «Consultando…»", () => {
    mockResult(trpc.auth.me.useQuery, {
      data: { username: "piloto1", email: "piloto@liga.com", roles: [] },
      isPending: false,
      isError: false,
    });
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    // `dashboard.get` sin mockear → pendiente por defecto.
    renderHome(<HomePage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("en error: muestra el mensaje de fallo", () => {
    mockResult(trpc.auth.me.useQuery, {
      data: { username: "piloto1", email: "piloto@liga.com", roles: [] },
      isPending: false,
      isError: false,
    });
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.dashboard.get.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderHome(<HomePage />);
    expect(
      screen.getByText(/No se pudo cargar el dashboard: fallo de red/),
    ).toBeInTheDocument();
  });

  it("próximo GP: jornada, circuito, fecha y cuenta atrás al lockout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    try {
      renderDashboard(dashboardOk);
      const gpCard = card("Próximo GP");
      expect(gpCard.getByText("J3 · GP de España")).toBeInTheDocument();
      expect(gpCard.getByText("Circuito de Jerez (España)")).toBeInTheDocument();
      expect(gpCard.getByText(/1 de junio de 2026/)).toBeInTheDocument();
      expect(gpCard.getByText(/Cierra en 2 h 30 min/)).toBeInTheDocument();
      expect(
        gpCard.getByRole("link", { name: "Componer mi lineup" }),
      ).toHaveAttribute("href", "/lineups");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cuenta atrás de menos de una hora: solo minutos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T14:00:00Z"));
    try {
      renderDashboard({
        ...dashboardOk,
        nextGp: { ...nextGp, lockoutAt: new Date("2026-06-01T14:40:00Z") },
      });
      const gpCard = card("Próximo GP");
      expect(gpCard.getByText(/Cierra en 40 min/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("GP cerrado: «Cerrado (lockout)» y sin cuenta atrás", () => {
    renderDashboard({
      ...dashboardOk,
      nextGp: { ...nextGp, closed: true },
    });
    const gpCard = card("Próximo GP");
    expect(gpCard.getByText("Cerrado (lockout)")).toBeInTheDocument();
    expect(gpCard.queryByText("Cierra en")).not.toBeInTheDocument();
  });

  it("sin lockout fijado: «Sin lockout fijado»", () => {
    renderDashboard({
      ...dashboardOk,
      nextGp: { ...nextGp, lockoutAt: null },
    });
    const gpCard = card("Próximo GP");
    expect(gpCard.getByText("Sin lockout fijado")).toBeInTheDocument();
    expect(gpCard.queryByText("Cierra en")).not.toBeInTheDocument();
  });

  it("presupuesto y lineup: total, base+carry, coste, saldo y cambios", () => {
    renderDashboard(dashboardOk);
    const cardEl = card("Presupuesto y lineup");
    expect(cardEl.getByText("Presupuesto:")).toBeInTheDocument();
    expect(cardEl.getByText("105")).toBeInTheDocument(); // total
    expect(
      cardEl.getByText(/\(base 100 \+ carry 5\)/),
    ).toBeInTheDocument(); // base + carry
    expect(cardEl.getByText("Coste:")).toBeInTheDocument();
    expect(cardEl.getByText("95")).toBeInTheDocument();
    expect(cardEl.getByText("Saldo:")).toBeInTheDocument();
    expect(cardEl.getByText("10")).toBeInTheDocument();
    expect(cardEl.getByText("Cambios restantes:")).toBeInTheDocument();
    expect(cardEl.getByText("2")).toBeInTheDocument();
  });

  it("sin lineup: aviso vacío y CTA «Guardar mi lineup»", () => {
    renderDashboard({ ...dashboardOk, lineup: null });
    const cardEl = card("Presupuesto y lineup");
    expect(cardEl.getByText("Aún no has guardado tu lineup.")).toBeInTheDocument();
    expect(
      cardEl.getByRole("link", { name: "Guardar mi lineup" }),
    ).toHaveAttribute("href", "/lineups");
    expect(cardEl.queryByText("Coste:")).not.toBeInTheDocument();
  });

  it("ligas: posición por GP y general", () => {
    renderDashboard(dashboardOk);
    const cardEl = card("Mis ligas");
    expect(cardEl.getByText("Liga A")).toBeInTheDocument();
    expect(cardEl.getByText(/GP: posición 2 \(150.5 pts\)/)).toBeInTheDocument();
    expect(
      cardEl.getByText(/General: posición 3 \(800.25 pts\)/),
    ).toBeInTheDocument();
  });

  it("liga sin posiciones: «sin posiciones aún»", () => {
    renderDashboard({
      ...dashboardOk,
      leagues: [
        {
          leagueId: "l1",
          leagueName: "Liga A",
          gpPosition: null,
          gpPoints: null,
          overallPosition: null,
          overallPoints: null,
        },
      ],
    });
    const cardEl = card("Mis ligas");
    expect(cardEl.getByText("Liga A")).toBeInTheDocument();
    expect(cardEl.getByText(/sin posiciones aún/)).toBeInTheDocument();
  });

  it("sin ligas: mensaje vacío elegante", () => {
    renderDashboard({ ...dashboardOk, leagues: [] });
    const cardEl = card("Mis ligas");
    expect(
      cardEl.getByText("Aún no formas parte de ninguna liga."),
    ).toBeInTheDocument();
  });

  it("temporada sin GPs programados: mensaje del próximo GP", () => {
    renderDashboard({
      ...dashboardOk,
      nextGp: null,
      budget: null,
      lineup: null,
    });
    expect(
      screen.getByText("No hay próximos GPs programados en la temporada."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sin próximo GP: presupuesto no disponible."),
    ).toBeInTheDocument();
  });

  it("sin temporadas: «Aún no hay temporadas.»", () => {
    renderDashboard({
      ...dashboardOk,
      season: null,
      nextGp: null,
      budget: null,
      lineup: null,
    });
    expect(screen.getByText("Aún no hay temporadas.")).toBeInTheDocument();
  });

  it("avisos: warning (lockout) e info (recálculo) con sus variantes", () => {
    renderDashboard({
      ...dashboardOk,
      notices: [
        {
          kind: "lockout",
          severity: "warning",
          message: "Cierre de lineups (lockout) del GP GP de España el 2026-06-01T14:30:00.000Z.",
          gpId: "gp-1",
          gpName: "GP de España",
          at: new Date("2026-06-01T14:30:00Z"),
        },
        {
          kind: "recalculo",
          severity: "info",
          message: "Resultados actualizados en GP de España (2 correcciones, última el 2026-05-30T09:00:00.000Z).",
          gpId: "gp-1",
          gpName: "GP de España",
          at: new Date("2026-05-30T09:00:00Z"),
        },
      ],
    });
    expect(screen.getByText("Avisos")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cierre de lineups (lockout) del GP GP de España el 2026-06-01T14:30:00.000Z.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Resultados actualizados en GP de España \(2 correcciones/,
      ),
    ).toBeInTheDocument();
  });

  it("anónimo: no renderiza el dashboard", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("sin sesión"),
    });
    renderHome(<HomePage />);
    expect(screen.queryByText("Próximo GP")).not.toBeInTheDocument();
    expect(screen.queryByText("Presupuesto y lineup")).not.toBeInTheDocument();
    expect(screen.queryByText("Mis ligas")).not.toBeInTheDocument();
  });
});
