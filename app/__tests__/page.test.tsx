// @vitest-environment jsdom
/**
 * Tests de la home (`app/page.tsx`):
 * - T-24, fase C: estado del sistema (health).
 * - US-15: dashboard (próximo GP con cuenta atrás a lockout, presupuesto,
 *   coste del lineup, posición en cada liga y avisos).
 * - T-26: la nav «Secciones» y la sesión (me/logout) viven en la cabecera
 *   global (`Header`) — sus tests están en
 *   `app/shared/components/__tests__/header.test.tsx`.
 *
 * Todo sobre el `trpc` mockeado.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks, trpc } from "../../test/trpc-mock";
import { resetNavigationMocks } from "../../test/ui-mocks";
import { render, screen, within } from "../../test/rtl";

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

/**
 * Error de `auth.me` sin sesión (F3 P3-1): `protectedProcedure` lanza
 * UNAUTHORIZED y el `errorFormatter` lo lleva en `data.code`. La home lo
 * distingue de un fallo real (500, red) para no enmascararlo.
 */
const unauthorizedError = Object.assign(new Error("No estás autenticado"), {
  data: { code: "UNAUTHORIZED" },
});

/**
 * Sesión activa de un global_admin (F3 P2): «Estado del sistema» es
 * información de administración → solo lo ve un global_admin.
 */
const loggedInMe = {
  data: { username: "piloto1", email: "piloto@liga.com", roles: ["global_admin"] },
  isPending: false,
  isError: false,
};

describe("HomePage", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("T-26: la home ya no lleva nav ni sección de sesión (viven en la cabecera global)", () => {
    renderHome(<HomePage />);
    // La nav «Secciones» y la zona de sesión (username, logout) se movieron
    // a `Header` (una sola vez, en todas las páginas) — la home no las
    // duplica.
    expect(
      screen.queryByRole("navigation", { name: "Secciones" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Sesión")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cerrar sesión" }),
    ).not.toBeInTheDocument();
  });

  it("pinta la CTA de conversión en el primer paint, sin esperar a la sesión (F3 P1)", () => {
    renderHome(<HomePage />);
    // F3 P1: la landing no debe esperar a `auth.me` para ofrecer su acción
    // principal — sin CTA, el primer paint es un callejón sin salida.
    expect(screen.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute(
      "href",
      "/registro",
    );
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
    // F3 P2: el directorio de ligas vive en la nav, no en la CTA de conversión.
    expect(
      screen.queryByRole("link", { name: "Ver ligas públicas" }),
    ).not.toBeInTheDocument();
  });

  it("muestra el sistema operativo con dependencias conectadas (global_admin)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    // F3 P1: el estado operativo solo se muestra con sesión activa.
    mockResult(trpc.auth.me.useQuery, loggedInMe);
    renderHome(<HomePage />);
    expect(screen.getByText("operativa")).toBeInTheDocument();
    expect(screen.getByText("conectada")).toBeInTheDocument();
    expect(screen.getByText("conectado")).toBeInTheDocument();
  });

  it("muestra el sistema degradado cuando una dependencia falla (logueado)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: { ...healthOk, status: "degradada", database: { ok: false } },
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, loggedInMe);
    renderHome(<HomePage />);
    expect(screen.getByText("degradada")).toBeInTheDocument();
    expect(screen.getByText("sin conexión")).toBeInTheDocument();
  });

  it("muestra el error si no se pudo consultar el estado (logueado)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("timeout de red"),
    });
    mockResult(trpc.auth.me.useQuery, loggedInMe);
    renderHome(<HomePage />);
    expect(
      screen.getByText(/No se pudo consultar el estado: timeout de red/),
    ).toBeInTheDocument();
  });

  it("error de tRPC crudo: mensaje amigable, no el código (F3 P3)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("INTERNAL_SERVER_ERROR"),
    });
    mockResult(trpc.auth.me.useQuery, loggedInMe);
    renderHome(<HomePage />);
    // F3 P3: los códigos de tRPC no son legibles para el usuario.
    expect(
      screen.getByText(/No se pudo consultar el estado: el servidor no pudo responder/),
    ).toBeInTheDocument();
  });

  it("no expone el estado del sistema a un visitante anónimo (F3 P1)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: unauthorizedError,
    });
    renderHome(<HomePage />);
    // F3 P1: BD/Redis/versión son información operativa → no se muestran a
    // quien no ha iniciado sesión.
    expect(screen.queryByText("Estado del sistema")).not.toBeInTheDocument();
    expect(screen.queryByText("operativa")).not.toBeInTheDocument();
    expect(screen.queryByText("conectada")).not.toBeInTheDocument();
  });

  it("anónimo: la conversión vive en la CTA row, sin sección «Sesión» redundante (F3 P2)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: unauthorizedError,
    });
    renderHome(<HomePage />);
    // F3 P2: la conversión (crear cuenta / iniciar sesión) vive en la CTA row.
    // Barrido P2 /: ahora hay también una CTA de cierre al final de la landing —
    // la del hero es la primera.
    expect(
      screen.getAllByRole("link", { name: "Crear cuenta" })[0],
    ).toHaveAttribute("href", "/registro");
    expect(
      screen.getAllByRole("link", { name: "Iniciar sesión" })[0],
    ).toHaveAttribute("href", "/login");
    // F3 P2: la sección «Sesión» no se muestra a un anónimo (no duplica la CTA).
    expect(screen.queryByText(/No has iniciado sesión/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sesión")).not.toBeInTheDocument();
  });

  it("anónimo: CTA de arranque «Crear cuenta» + «Iniciar sesión» (F3 P1)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: unauthorizedError,
    });
    renderHome(<HomePage />);
    // F3 P1: la conversión principal es visible bajo el tagline, no enterrada
    // en «Sesión».
    // Barrido P2 /: ahora hay también una CTA de cierre al final de la landing —
    // la del hero es la primera.
    expect(
      screen.getAllByRole("link", { name: "Crear cuenta" })[0],
    ).toHaveAttribute("href", "/registro");
    expect(
      screen.getAllByRole("link", { name: "Iniciar sesión" })[0],
    ).toHaveAttribute("href", "/login");
    // F3 P2: dos CTAs de conversión; el directorio de ligas vive en la nav.
    expect(
      screen.queryByRole("link", { name: "Ver ligas públicas" }),
    ).not.toBeInTheDocument();
  });

  it("anónimo: la home no ofrece enlaces a secciones (viven en la cabecera, T-26)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: unauthorizedError,
    });
    renderHome(<HomePage />);
    // T-26: el acceso a las secciones (públicas y privadas) vive en la
    // cabecera global — la home no duplica enlaces de sección.
    // Barrido P3 /: la etiqueta unificada es «Ligas» (nav + /ligas).
    expect(screen.queryByRole("link", { name: "Ligas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Lineups" })).not.toBeInTheDocument();
    expect(screen.queryByText(/requieren una cuenta/)).not.toBeInTheDocument();
  });

  it("anónimo: vende el producto (valor + cómo funciona), no su estado (F3 P1)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: unauthorizedError,
    });
    renderHome(<HomePage />);
    // F3 P1: la home anónima tiene estructura de landing, no de página de estado.
    expect(
      screen.getByRole("heading", { name: "¿Por qué este fantasy?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Economía justa" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Multi-liga" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Transparente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cómo funciona" })).toBeInTheDocument();
    expect(screen.getByText(/gratis, en un minuto/)).toBeInTheDocument();
    expect(
      screen.getByText(/2 oro \+ 2 plata \+ constructor \+ equipo/),
    ).toBeInTheDocument();
    // …y no muestra el dashboard de sesión.
    expect(screen.queryByText("Tu temporada")).not.toBeInTheDocument();
  });

  it("anónimo: la landing termina en la CTA de cierre (barrido P2 /)", () => {
    mockResult(trpc.health.check.useQuery, {
      data: healthOk,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: unauthorizedError,
    });
    renderHome(<HomePage />);
    // Barrido P2 /: en móvil la CTA del hero puede quedar fuera de viewport al
    // terminar la lectura — la landing cierra en la acción de conversión.
    // Dos CTAs de cierre (mismo par y misma copy que el hero).
    const crear = screen.getAllByRole("link", { name: "Crear cuenta" });
    const login = screen.getAllByRole("link", { name: "Iniciar sesión" });
    expect(crear.length).toBe(2);
    expect(login.length).toBe(2);
    // …y apuntan a los destinos de conversión.
    expect(crear[1]).toHaveAttribute("href", "/registro");
    expect(login[1]).toHaveAttribute("href", "/login");
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
      expect(gpCard.getByText("GP 3 · GP de España")).toBeInTheDocument();
      expect(gpCard.getByText("Circuito de Jerez (España)")).toBeInTheDocument();
      expect(gpCard.getByText(/1 de junio de 2026/)).toBeInTheDocument();
      expect(gpCard.getByText(/Cierra en 2 h 30 min/)).toBeInTheDocument();
      // F3 P3: con lineup ya guardado la CTA invita a editarlo.
      expect(gpCard.getByRole("link", { name: "Editar mi lineup" })).toHaveAttribute(
        "href",
        "/lineups",
      );
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

  it("cuenta atrás de menos de un minuto: «menos de 1 min» (F3 P3)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T14:29:30Z"));
    try {
      renderDashboard({
        ...dashboardOk,
        nextGp: { ...nextGp, lockoutAt: new Date("2026-06-01T14:30:00Z") },
      });
      const gpCard = card("Próximo GP");
      // F3 P3: antes mostraba «Cierra en 0 min».
      expect(gpCard.getByText(/Cierra en menos de 1 min/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("GP cerrado: «Cambios cerrados» y sin cuenta atrás", () => {
    renderDashboard({
      ...dashboardOk,
      nextGp: { ...nextGp, closed: true },
    });
    const gpCard = card("Próximo GP");
    // F3 P3: sin jerga («lockout») en la UI.
    expect(gpCard.getByText("Cambios cerrados")).toBeInTheDocument();
    expect(gpCard.queryByText("Cierra en")).not.toBeInTheDocument();
    // F3 P1: con lockout el servidor rechaza guardar → la CTA pasa a solo lectura.
    expect(gpCard.getByRole("link", { name: "Ver mi lineup" })).toHaveAttribute(
      "href",
      "/lineups",
    );
    expect(
      gpCard.queryByRole("link", { name: "Componer mi lineup" }),
    ).not.toBeInTheDocument();
  });

  it("GP cerrado y sin lineup: la CTA «Guardar mi lineup» se oculta (F3 P1)", () => {
    renderDashboard({
      ...dashboardOk,
      lineup: null,
      nextGp: { ...nextGp, closed: true },
    });
    const cardEl = card("Presupuesto y lineup");
    expect(cardEl.getByText("Aún no has guardado tu lineup.")).toBeInTheDocument();
    expect(
      cardEl.queryByRole("link", { name: "Guardar mi lineup" }),
    ).not.toBeInTheDocument();
  });

  it("GP cerrado sin lineup: nota neutra + enlace a resultados, no un callejón (F3 P3)", () => {
    renderDashboard({
      ...dashboardOk,
      lineup: null,
      nextGp: { ...nextGp, closed: true },
    });
    const gpCard = card("Próximo GP");
    // F3 P3: el cierre sin lineup orienta a lo accionable (ver resultados);
    // /lineups no permite editar ese GP cerrado.
    expect(gpCard.getByText(/El cierre de cambios ya pasó/)).toBeInTheDocument();
    expect(gpCard.getByRole("link", { name: "Ver resultados" })).toHaveAttribute(
      "href",
      "/resultados",
    );
    // Sin CTA de composición (el servidor la rechazaría tras el cierre).
    expect(
      gpCard.queryByRole("link", { name: "Componer mi lineup" }),
    ).not.toBeInTheDocument();
  });

  it("sin fecha de cierre: «Sin fecha de cierre»", () => {
    renderDashboard({
      ...dashboardOk,
      nextGp: { ...nextGp, lockoutAt: null },
    });
    const gpCard = card("Próximo GP");
    // F3 P3: sin jerga («lockout») en la UI.
    expect(gpCard.getByText("Sin fecha de cierre")).toBeInTheDocument();
    expect(gpCard.queryByText("Cierra en")).not.toBeInTheDocument();
  });

  it("presupuesto y lineup: total, base+carry, coste, saldo y cambios", () => {
    renderDashboard(dashboardOk);
    const cardEl = card("Presupuesto y lineup");
    expect(cardEl.getByText("Presupuesto:")).toBeInTheDocument();
    expect(cardEl.getByText("105")).toBeInTheDocument(); // total
    expect(cardEl.getByText(/\(base 100 \+ carry 5\)/)).toBeInTheDocument(); // base + carry
    expect(cardEl.getByText("Coste:")).toBeInTheDocument();
    expect(cardEl.getByText("95")).toBeInTheDocument();
    expect(cardEl.getByText("Saldo:")).toBeInTheDocument();
    // F3 P3: un saldo positivo es neutro (no un logro); solo el negativo se colorea.
    expect(cardEl.getByText("10")).not.toHaveClass("ok");
    expect(cardEl.getByText("10")).not.toHaveClass("bad");
    expect(cardEl.getByText("Cambios restantes:")).toBeInTheDocument();
    expect(cardEl.getByText("2")).toBeInTheDocument();
  });

  it("saldo negativo: señal negativa (rojo) (F3 P2)", () => {
    renderDashboard({
      ...dashboardOk,
      lineup: { ...dashboardOk.lineup, cost: 110, balance: -5 },
    });
    const cardEl = card("Presupuesto y lineup");
    // F3 P2: un saldo negativo se distingue del positivo.
    expect(cardEl.getByText("-5")).toHaveClass("bad");
  });

  it("sin lineup: aviso vacío; la CTA de acción está en «Próximo GP» (F3 P3)", () => {
    renderDashboard({ ...dashboardOk, lineup: null });
    const cardEl = card("Presupuesto y lineup");
    expect(cardEl.getByText("Aún no has guardado tu lineup.")).toBeInTheDocument();
    expect(cardEl.queryByText("Coste:")).not.toBeInTheDocument();
    // F3 P3: antes había doble CTA a /lineups («Componer» + «Guardar»).
    expect(
      cardEl.queryByRole("link", { name: "Guardar mi lineup" }),
    ).not.toBeInTheDocument();
    expect(
      card("Próximo GP").getByRole("link", { name: "Componer mi lineup" }),
    ).toHaveAttribute("href", "/lineups");
  });

  it("ligas: posición por GP y general", () => {
    renderDashboard(dashboardOk);
    const cardEl = card("Mis ligas");
    expect(cardEl.getByText("Liga A")).toBeInTheDocument();
    expect(cardEl.getByText(/GP: posición 2 \(150.5 pts\)/)).toBeInTheDocument();
    expect(cardEl.getByText(/General: posición 3 \(800.25 pts\)/)).toBeInTheDocument();
    // F3 P2: el nombre de la liga enlaza a su detalle.
    expect(cardEl.getByRole("link", { name: "Liga A" })).toHaveAttribute(
      "href",
      "/ligas/l1",
    );
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
    // F3 P3: sin el prefijo «— » (quedaba torpe).
    expect(cardEl.getByText(/Sin posiciones aún/)).toBeInTheDocument();
  });

  it("sin ligas: mensaje vacío con salida a ligas públicas (F3 P2)", () => {
    renderDashboard({ ...dashboardOk, leagues: [] });
    const cardEl = card("Mis ligas");
    expect(cardEl.getByText("Aún no formas parte de ninguna liga.")).toBeInTheDocument();
    // F3 P2: el empty state ofrece cómo empezar (antes: callejón sin salida).
    // Barrido P3 /: etiqueta unificada con la nav global y el título de /ligas
    // («Ligas»; antes «Ligas públicas», que no coincidía con la nav).
    expect(cardEl.getByRole("link", { name: "Ligas" })).toHaveAttribute(
      "href",
      "/ligas",
    );
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
          message:
            "Cierre de lineups (lockout) del GP GP de España el 2026-06-01T14:30:00.000Z.",
          gpId: "gp-1",
          gpName: "GP de España",
          at: new Date("2026-06-01T14:30:00Z"),
        },
        {
          kind: "recalculo",
          severity: "info",
          message:
            "Resultados actualizados en GP de España (2 correcciones, última el 2026-05-30T09:00:00.000Z).",
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
      screen.getByText(/Resultados actualizados en GP de España \(2 correcciones/),
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
      error: unauthorizedError,
    });
    renderHome(<HomePage />);
    expect(screen.queryByText("Próximo GP")).not.toBeInTheDocument();
    expect(screen.queryByText("Presupuesto y lineup")).not.toBeInTheDocument();
    expect(screen.queryByText("Mis ligas")).not.toBeInTheDocument();
  });
});
