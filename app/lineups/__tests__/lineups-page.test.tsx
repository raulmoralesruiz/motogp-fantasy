// @vitest-environment jsdom
/**
 * Tests de `app/lineups/lineups-page.tsx` (US-09): selección de
 * temporada/GP, builder con coste en vivo, prefill del borrador desde el
 * lineup guardado, lockout y guardado sobre el `trpc` mockeado.
 */
import { getQueryKey } from "@trpc/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { act, render, screen, userEvent, within } from "../../../test/rtl";

import LineupsPage from "../lineups-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

const SEASON_ID = "season-2026";
// `status: "scheduled"` (F3): activa la preselección del primer GP por ronda
// en el pre-select de la página; los tests de lockout lo sobrescriben.
const GP1 = { id: "gp-1", name: "GP de Jerez", round: 1, status: "scheduled" };
const GP2 = { id: "gp-2", name: "GP de Portugal", round: 2, status: "scheduled" };

const RIDERS = [
  {
    riderId: "r1",
    name: "Piloto Uno",
    teamName: "Team A",
    constructorName: "Ctor A",
    price: 10,
  },
  {
    riderId: "r2",
    name: "Piloto Dos",
    teamName: "Team A",
    constructorName: "Ctor A",
    price: 15,
  },
  {
    riderId: "r3",
    name: "Piloto Tres",
    teamName: "Team B",
    constructorName: "Ctor B",
    price: 20,
  },
  {
    riderId: "r4",
    name: "Piloto Cuatro",
    teamName: "Team B",
    constructorName: "Ctor B",
    price: 25,
  },
  {
    riderId: "rx",
    name: "Piloto Sin Precio",
    teamName: "Team A",
    constructorName: "Ctor A",
    price: null,
  },
];
const CONSTRUCTORS = [
  { id: "ctor-a", name: "Ctor A", price: 5 },
  { id: "ctor-b", name: "Ctor B", price: 30 },
];
const TEAMS = [
  {
    id: "team-a",
    name: "Team A",
    constructorId: "ctor-a",
    constructorName: "Ctor A",
    price: 5,
  },
  {
    id: "team-b",
    name: "Team B",
    constructorId: "ctor-b",
    constructorName: "Ctor B",
    price: 5.01,
  },
];

/** Presupuesto por defecto del builder (primer GP, sin carry). */
const BUDGET = { base: 100, carry: 0, total: 100 };

/**
 * Opciones del builder mockeado (mercado, presupuesto y estado). Los tipos de
 * activo admiten `price: null` (activo sin precio en el GP, como en la API).
 */
type BuilderOverrides = {
  status?: string;
  lockoutAt?: Date | null;
  budget?: typeof BUDGET;
  wildcardsUsed?: number;
  wildcardsPerSeason?: number;
  riders?: Array<Omit<(typeof RIDERS)[number], "price"> & { price: number | null }>;
  constructors?: Array<
    Omit<(typeof CONSTRUCTORS)[number], "price"> & { price: number | null }
  >;
  teams?: Array<Omit<(typeof TEAMS)[number], "price"> & { price: number | null }>;
};

/** Datos del builder para un GP (el mismo mercado para ambos GPs de prueba). */
function builderData(gp: typeof GP1, overrides: BuilderOverrides = {}) {
  return {
    gp: {
      ...gp,
      status: overrides.status ?? "scheduled",
      lockoutAt: overrides.lockoutAt ?? null,
    },
    budget: overrides.budget ?? BUDGET,
    riders: overrides.riders ?? RIDERS,
    constructors: overrides.constructors ?? CONSTRUCTORS,
    teams: overrides.teams ?? TEAMS,
    wildcardsUsed: overrides.wildcardsUsed ?? 0,
    wildcardsPerSeason: overrides.wildcardsPerSeason ?? 1,
  };
}

const LINEUP_GP1 = {
  gpId: GP1.id,
  cost: 80,
  budget: 100,
  balance: 20,
  slots: {
    gold: ["r1", "r2"],
    silver: ["r3", "r4"],
    constructorId: "ctor-a",
    teamId: "team-a",
  },
  usedChanges: 0,
  remainingChanges: 2,
  updatedAt: new Date("2026-10-20T10:00:00Z"),
};

function renderLineups(ui: ReactElement) {
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
      { id: SEASON_ID, name: "2026" },
      { id: "season-2027", name: "2027" },
    ],
    isPending: false,
    isError: false,
  });
}

function mockGps() {
  mockResult(trpc.seasons.gps.list.useQuery, {
    data: [GP1, GP2],
    isPending: false,
    isError: false,
  });
}

function mockBuilder(gp: typeof GP1, overrides?: BuilderOverrides) {
  mockResult(trpc.lineups.builder.useQuery, {
    data: builderData(gp, overrides),
    isPending: false,
    isError: false,
  });
}

function mockLineup(data: typeof LINEUP_GP1 | null) {
  mockResult(trpc.lineups.get.useQuery, {
    data,
    isPending: false,
    isError: false,
  });
}

/**
 * Opciones de la mutation (onSuccess/onError) de la ÚLTIMA invocación del
 * hook: las opciones de renders anteriores cierran sobre estado viejo
 * (p. ej. `gpId` aún vacío).
 */
function mutationOptions(hook: unknown): {
  onSuccess?: (result: unknown, variables?: unknown) => void;
  onError?: (err: unknown) => void;
} {
  const calls = asMockFn(hook).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as {
    onSuccess?: (result: unknown, variables?: unknown) => void;
    onError?: (err: unknown) => void;
  };
}

/** Rellena la composición completa: 2 oro + 2 plata + constructor + equipo. */
async function fillDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Piloto oro 1"), "r1");
  await user.selectOptions(screen.getByLabelText("Piloto oro 2"), "r2");
  await user.selectOptions(screen.getByLabelText("Piloto plata 1"), "r3");
  await user.selectOptions(screen.getByLabelText("Piloto plata 2"), "r4");
  await user.selectOptions(screen.getByLabelText("Constructor"), "ctor-a");
  await user.selectOptions(screen.getByLabelText("Equipo"), "team-a");
}

/** Navega hasta el builder del GP1 (temporada + GP). */
async function openGp1(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
  await user.selectOptions(screen.getByLabelText("GP"), GP1.id);
}

describe("LineupsPage", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  it("muestra el estado pendiente", () => {
    renderLineups(<LineupsPage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra un error si la lista de temporadas falla", () => {
    mockResult(trpc.seasons.list.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderLineups(<LineupsPage />);
    // Error de página (no de sección): mensaje sereno, patrón /mercado.
    expect(
      screen.getByText("No se pudo cargar la lista de temporadas."),
    ).toBeInTheDocument();
  });

  it("abre con temporada y GP pre-seleccionados y pide un GP si la temporada no tiene", async () => {
    mockSeasons();
    // 2026 sin GPs programados: en esa temporada no hay GP que pre-seleccionar.
    asMockFn(trpc.seasons.gps.list.useQuery).mockImplementation(
      (input: { seasonId: string }) => ({
        data: input.seasonId === SEASON_ID ? [] : [GP1, GP2],
        isPending: false,
        isError: false,
      }),
    );
    renderLineups(<LineupsPage />);

    // F3 (pre-selección): la página abre donde el fan va a trabajar — la
    // temporada más reciente y el primer GP programado por ronda —, no en
    // "— Temporada —".
    expect(screen.getByLabelText("Temporada")).toHaveValue("season-2027");
    expect(screen.getByLabelText("GP")).toHaveValue(GP1.id);

    const user = userEvent.setup();
    // En una temporada sin GPs, la pre-selección no puede inventar uno:
    // la página nombra el estado real (F3 P3), no "falta elegir GP".
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);

    expect(
      screen.getByText("Esta temporada no tiene GPs programados todavía."),
    ).toBeInTheDocument();
    // La pre-selección no inventa un GP: el selector queda sin opciones
    // (solo el marcador) y sin builder no hay botón de guardado.
    expect(
      screen.queryByRole("option", { name: "J1 · GP de Jerez" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "— GP —" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar lineup" }),
    ).not.toBeInTheDocument();
  });

  it("sin temporada elegida: la instrucción es elegir temporada (no GP)", async () => {
    // F3 P2: sin temporada, el select de GP está oculto — la instrucción no
    // puede ser "Selecciona un GP" (un control que no existe). La única
    // forma de tener `seasonId=""` con temporadas cargadas es que la lista
    // esté vacía (la pre-selección no puede inventar una).
    mockResult(trpc.seasons.list.useQuery, {
      data: [],
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    expect(screen.getByText("Selecciona una temporada.")).toBeInTheDocument();
    expect(screen.queryByLabelText("GP")).not.toBeInTheDocument();
  });

  it("muestra el lineup guardado (presupuesto, coste, saldo, cambios) y rellena el borrador", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(screen.getByText("Presupuesto:")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("(base 100 + carry 0)")).toBeInTheDocument();
    // F3 (P1-2 + P2): dos sub-bloques en lenguaje de fan — lo que YA está
    // en juego (guardado) y lo que pasa si guardas el borrador ahora.
    // Aquí el borrador coincide con el guardado (prefill idéntico).
    expect(screen.getByText("Tu lineup (en juego):")).toBeInTheDocument();
    expect(screen.getByText("coste 80 · saldo 20")).toBeInTheDocument();
    expect(screen.getByText("· cambios restantes 2")).toBeInTheDocument();
    expect(screen.getByText("Si guardas ahora:")).toBeInTheDocument();
    expect(screen.getByText("Si guardas ahora:")).not.toHaveClass("status-dirty");
    expect(screen.getByText("coste 80")).toBeInTheDocument();
    expect(screen.getByText("· saldo 20")).toBeInTheDocument();

    // Prefill desde el lineup guardado.
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("r1");
    expect(screen.getByLabelText("Piloto oro 2")).toHaveValue("r2");
    expect(screen.getByLabelText("Piloto plata 1")).toHaveValue("r3");
    expect(screen.getByLabelText("Piloto plata 2")).toHaveValue("r4");
    expect(screen.getByLabelText("Constructor")).toHaveValue("ctor-a");
    expect(screen.getByLabelText("Equipo")).toHaveValue("team-a");
  });

  it("barrido P3: el prefill no pisa slots ya elegidos por el usuario (carrera rara)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    // `lineups.get` queda pendiente (default del mock): el lineup llega tarde.
    const { rerender, queryClient } = renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // El fan elige un piloto ANTES de que llegue `lineup.data`.
    await user.selectOptions(screen.getByLabelText("Piloto oro 1"), "r3");

    // Llega el lineup guardado: el prefill se salta (no pisar la entrada).
    // `rerender` re-renderiza la raíz: hay que reenvolver el provider.
    mockLineup(LINEUP_GP1);
    rerender(
      <QueryClientProvider client={queryClient}>
        <LineupsPage />
      </QueryClientProvider>,
    );

    // La elección del usuario se conserva; el resto NO se rellena a tope
    // (el prefill no se aplica a medias).
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("r3");
    expect(screen.getByLabelText("Piloto oro 2")).toHaveValue("");
    expect(screen.getByLabelText("Constructor")).toHaveValue("");
  });

  it("sin lineup guardado muestra el presupuesto (base + carry) y el coste en vivo", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // US-10: el presupuesto se ve ANTES del primer save.
    expect(screen.getByText("Presupuesto:")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("(base 100 + carry 0)")).toBeInTheDocument();

    // Borrador incompleto → coste desconocido.
    expect(screen.getByText("Si guardas ahora:")).toBeInTheDocument();
    expect(screen.getByText("coste —")).toBeInTheDocument();

    // 10 + 15 + 20 + 25 + 5 (constructor) + 5 (equipo) = 80.
    await fillDraft(user);
    expect(screen.getByText("coste 80")).toBeInTheDocument();
  });

  it("US-10: con carry, muestra el desglose base + carry antes del primer save", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1, { budget: { base: 100, carry: 5, total: 105 } });
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(screen.getByText("Presupuesto:")).toBeInTheDocument();
    expect(screen.getByText("105")).toBeInTheDocument();
    expect(screen.getByText("(base 100 + carry 5)")).toBeInTheDocument();
  });

  it("deshabilita los pilotos ya elegidos en otro slot y los sin precio", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // Piloto sin precio congelado: deshabilitado y marcado.
    const gold1 = screen.getByLabelText("Piloto oro 1");
    expect(
      within(gold1).getByRole("option", {
        name: "Piloto Sin Precio (Team A) — sin precio",
      }),
    ).toBeDisabled();

    // Elegido en oro 1 → deshabilitado en el resto de slots (no en el suyo),
    // con el motivo de bloqueo escrito en la opción (F3).
    await user.selectOptions(gold1, "r1");
    expect(
      within(screen.getByLabelText("Piloto oro 2")).getByRole("option", {
        name: "Piloto Uno (Team A) — 10 — ya en otro slot",
      }),
    ).toBeDisabled();
    expect(
      within(gold1).getByRole("option", {
        name: "Piloto Uno (Team A) — 10",
      }),
    ).not.toBeDisabled();
  });

  it("guardar: envía solo los IDs de los activos (nunca coste ni presupuesto)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    const mutate = vi.fn();
    mockResult(trpc.lineups.save.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Guardar lineup" }));

    expect(mutate).toHaveBeenCalledWith({
      gpId: GP1.id,
      slots: {
        gold: ["r1", "r2"],
        silver: ["r3", "r4"],
        constructorId: "ctor-a",
        teamId: "team-a",
      },
    });
  });

  it("guardar: el botón se deshabilita hasta completar la composición", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    mockResult(trpc.lineups.save.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    const button = screen.getByRole("button", { name: "Guardar lineup" });
    // Bloqueado con motivo escrito (F3: nunca un control bloqueado sin
    // explicación; aria-disabled para que el motivo se anuncie al enfocar).
    expect(button).toHaveAttribute("aria-disabled", "true");
    // El motivo vive en un span asociado a ESTE botón (aria-describedby): el
    // botón de wildcard muestra el mismo motivo, así que se asierta por
    // asociación, no por texto global.
    const saveReason = button.getAttribute("aria-describedby");
    expect(saveReason).not.toBeNull();
    expect(document.getElementById(saveReason!)).toHaveTextContent(
      "Composición incompleta: faltan piloto oro 1, piloto oro 2, piloto plata 1, piloto plata 2, constructor, equipo.",
    );

    await user.selectOptions(screen.getByLabelText("Piloto oro 1"), "r1");
    expect(button).toHaveAttribute("aria-disabled", "true");

    await fillDraft(user);
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("guardar: tras el éxito muestra el mensaje e invalida la consulta del lineup", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    mockResult(trpc.lineups.save.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    const { queryClient } = renderLineups(<LineupsPage />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Guardar lineup" }));

    await act(async () => {
      mutationOptions(trpc.lineups.save.useMutation).onSuccess?.(
        {
          gpId: GP1.id,
          cost: 80,
          budget: 100,
          balance: 20,
          changesApplied: 0,
          remainingChanges: 1,
          firstSave: true,
        },
        // `variables` (2º arg, React Query v5): el GP de ENVÍO.
        {
          gpId: GP1.id,
          slots: {
            gold: ["r1", "r2"],
            silver: ["r3", "r4"],
            constructorId: "ctor-a",
            teamId: "team-a",
          },
        },
      );
    });

    expect(
      screen.getByText("Lineup guardado para GP de Jerez. Cambios restantes: 1."),
    ).toBeInTheDocument();
    // Tras guardar, el historial y el builder también se refrescan
    // (mismo patrón que el wildcard): nada queda obsoleto en pantalla.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.get, { gpId: GP1.id }),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.history, { gpId: GP1.id }),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.builder, { gpId: GP1.id }),
    });
  });

  it("barrido P3: éxito con 0 cambios restantes sugiere el wildcard (si disponible)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    mockResult(trpc.lineups.save.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Guardar lineup" }));

    await act(async () => {
      mutationOptions(trpc.lineups.save.useMutation).onSuccess?.(
        {
          gpId: GP1.id,
          cost: 80,
          budget: 100,
          balance: 20,
          changesApplied: 2,
          remainingChanges: 0,
          firstSave: false,
        },
        {
          gpId: GP1.id,
          slots: {
            gold: ["r1", "r2"],
            silver: ["r3", "r4"],
            constructorId: "ctor-a",
            teamId: "team-a",
          },
        },
      );
    });

    // La salida accionable se nombra en el propio éxito (el error
    // server-side ya lo hacía; ahora también el camino feliz).
    expect(
      screen.getByText(
        "Lineup guardado para GP de Jerez. Cambios restantes: 0. Si no te quedan cambios, puedes usar tu wildcard de temporada.",
      ),
    ).toBeInTheDocument();
  });

  it("barrido P3: 0 cambios restantes pero wildcard ya usado → no lo sugiere", async () => {
    mockSeasons();
    mockGps();
    // Wildcard gastado: sugerirlo sería prometer un recurso no disponible.
    mockBuilder(GP1, { wildcardsUsed: 1, wildcardsPerSeason: 1 });
    mockLineup(null);
    mockResult(trpc.lineups.save.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Guardar lineup" }));

    await act(async () => {
      mutationOptions(trpc.lineups.save.useMutation).onSuccess?.(
        {
          gpId: GP1.id,
          cost: 80,
          budget: 100,
          balance: 20,
          changesApplied: 2,
          remainingChanges: 0,
          firstSave: false,
        },
        {
          gpId: GP1.id,
          slots: {
            gold: ["r1", "r2"],
            silver: ["r3", "r4"],
            constructorId: "ctor-a",
            teamId: "team-a",
          },
        },
      );
    });

    // Mensaje base sin la sugerencia (recurso gastado no se promete).
    expect(
      screen.getByText("Lineup guardado para GP de Jerez. Cambios restantes: 0."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/puedes usar tu wildcard/),
    ).not.toBeInTheDocument();
  });

  it("guardar: cambia de GP mientras el save vuela → el éxito nombra e invalida el GP de ENVÍO (no el de la pantalla)", async () => {
    mockSeasons();
    mockGps();
    // Builder por GP (el mercado de cada GP es el suyo, no el de GP1).
    asMockFn(trpc.lineups.builder.useQuery).mockImplementation(
      (input: { gpId: string }) => ({
        data: builderData(input.gpId === GP1.id ? GP1 : GP2),
        isPending: false,
        isError: false,
      }),
    );
    mockLineup(null);
    mockResult(trpc.lineups.save.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    const { queryClient } = renderLineups(<LineupsPage />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);
    // El save vuela: mutate se llama con gpId = GP1 (el GP de ENVÍO).
    await user.click(screen.getByRole("button", { name: "Guardar lineup" }));

    // Mientras el save vuela, el fan cambia a GP2 (confirmado). La pantalla
    // ahora muestra GP2, pero el save en vuelo es de GP1.
    await user.selectOptions(screen.getByLabelText("GP"), GP2.id);
    await user.click(screen.getByRole("button", { name: "Sí, cambiar de GP" }));
    expect(screen.getByLabelText("GP")).toHaveValue(GP2.id);

    // El save resuelve: el GP de ENVÍO era GP1, no GP2 (F3 P1: señal falsa de
    // éxito + caché obsoleta del GP guardado).
    await act(async () => {
      mutationOptions(trpc.lineups.save.useMutation).onSuccess?.(
        {
          gpId: GP1.id,
          cost: 80,
          budget: 100,
          balance: 20,
          changesApplied: 0,
          remainingChanges: 1,
          firstSave: true,
        },
        {
          gpId: GP1.id,
          slots: {
            gold: ["r1", "r2"],
            silver: ["r3", "r4"],
            constructorId: "ctor-a",
            teamId: "team-a",
          },
        },
      );
    });

    // El éxito nombra el GP que SÍ se guardó (GP1), no el de la pantalla (GP2).
    expect(
      screen.getByText(
        "Lineup guardado para GP de Jerez. Cambios restantes: 1.",
      ),
    ).toBeInTheDocument();
    // Y refresca las claves del GP guardado (GP1), no las del GP en pantalla.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.get, { gpId: GP1.id }),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.history, { gpId: GP1.id }),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.builder, { gpId: GP1.id }),
    });
  });

  it("guardar: si el save falla muestra el motivo del servidor", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    mockResult(trpc.lineups.save.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Guardar lineup" }));

    await act(async () => {
      mutationOptions(trpc.lineups.save.useMutation).onError?.(
        clientError(
          "El lineup excede el presupuesto por 0.01 (coste 100.01, presupuesto 100).",
          { code: "BAD_REQUEST" },
        ),
      );
    });

    expect(
      screen.getByText(
        "El lineup excede el presupuesto por 0.01 (coste 100.01, presupuesto 100).",
      ),
    ).toBeInTheDocument();
  });

  it("GP cerrado (status locked): alerta de lockout y botón deshabilitado", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1, { status: "locked" });
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByText("El GP está bloqueado (lockout): no se pueden guardar lineups."),
    ).toBeInTheDocument();

    // Con la composición completa, el bloqueo sigue por lockout y el motivo
    // escrito es del GP (no de la composición). El botón de wildcard muestra
    // el mismo motivo: se asierta por asociación (aria-describedby).
    await fillDraft(user);
    const button = screen.getByRole("button", { name: "Guardar lineup" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    const saveReason = button.getAttribute("aria-describedby");
    expect(saveReason).not.toBeNull();
    expect(document.getElementById(saveReason!)).toHaveTextContent(
      "El GP está bloqueado (lockout).",
    );
  });

  it("GP cerrado (lockoutAt en el pasado): alerta de lockout", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1, { lockoutAt: new Date(Date.now() - 3600_000) });
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByText("El GP está bloqueado (lockout): no se pueden guardar lineups."),
    ).toBeInTheDocument();
  });

  it("lockout próximo: el tick de 30 s re-evalúa el estado sin recargar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    try {
      mockSeasons();
      mockGps();
      // Cierre a 10 s: la página (pre-seleccionada en GP1) abre abierta y el
      // primer tick debe cerrarla.
      mockBuilder(GP1, { lockoutAt: new Date("2026-06-01T12:00:10Z") });
      mockLineup(null);
      renderLineups(<LineupsPage />);

      // Abierto: ahora (12:00:00) < lockoutAt (12:00:10).
      expect(
        screen.queryByText(
          "El GP está bloqueado (lockout): no se pueden guardar lineups.",
        ),
      ).not.toBeInTheDocument();

      // Tick de 30 s: now (12:00:30) ≥ lockoutAt → la lectura se cierra sola,
      // sin recargar ni esperar al error del servidor.
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(
        screen.getByText(
          "El GP está bloqueado (lockout): no se pueden guardar lineups.",
        ),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("al cambiar de GP se limpia el borrador", async () => {
    mockSeasons();
    mockGps();
    asMockFn(trpc.lineups.builder.useQuery).mockImplementation(
      (input: { gpId: string }) => ({
        data: builderData(input.gpId === GP1.id ? GP1 : GP2),
        isPending: false,
        isError: false,
      }),
    );
    asMockFn(trpc.lineups.get.useQuery).mockImplementation((input: { gpId: string }) => ({
      data: input.gpId === GP1.id ? LINEUP_GP1 : null,
      isPending: false,
      isError: false,
    }));
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("r1");

    await user.selectOptions(screen.getByLabelText("GP"), GP2.id);

    // GP2 sin lineup: borrador vacío y coste en vivo de nuevo.
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("");
    expect(screen.getByText("Si guardas ahora:")).toBeInTheDocument();
    expect(screen.getByText("coste —")).toBeInTheDocument();
  });

  it("cambiar de GP con borrador dirty: confirma con impacto y al cancelar no pierde nada", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    // Un cambio de slot (constructor) ensucia el borrador.
    await user.selectOptions(screen.getByLabelText("Constructor"), "ctor-b");
    expect(screen.getByText("Si guardas ahora:")).toHaveClass("status-dirty");

    // Intentar cambiar de GP: confirmación con impacto escrito (F3 P1-1) —
    // el trabajo del fan no se pierde en silencio.
    await user.selectOptions(screen.getByLabelText("GP"), GP2.id);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Cambiar de GP" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Los cambios del borrador que no hayas guardado se perderán.",
      ),
    ).toBeInTheDocument();

    // Opción segura («No, volver»): GP y borrador dirty se conservan intactos.
    await user.click(within(dialog).getByRole("button", { name: "No, volver" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("GP")).toHaveValue(GP1.id);
    expect(screen.getByLabelText("Constructor")).toHaveValue("ctor-b");
    expect(screen.getByText("Si guardas ahora:")).toHaveClass("status-dirty");
  });

  it("cambiar de GP con borrador NUEVO (sin lineup guardado): confirma y al cancelar conserva el borrador", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);

    // Trabajo sin guardar SIN lineup guardado: confirmación con impacto
    // escrito (F3 P1-1) — el borrador nuevo no se pierde en silencio.
    await user.selectOptions(screen.getByLabelText("GP"), GP2.id);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Cambiar de GP" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Los cambios del borrador que no hayas guardado se perderán.",
      ),
    ).toBeInTheDocument();

    // Opción segura: el borrador nuevo se conserva entero.
    await user.click(within(dialog).getByRole("button", { name: "No, volver" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("GP")).toHaveValue(GP1.id);
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("r1");
    expect(screen.getByLabelText("Piloto plata 2")).toHaveValue("r4");
    expect(screen.getByLabelText("Constructor")).toHaveValue("ctor-a");
    expect(screen.getByLabelText("Equipo")).toHaveValue("team-a");
  });

  it("cambiar de GP con borrador dirty: al confirmar cambia de GP y limpia el borrador", async () => {
    mockSeasons();
    mockGps();
    asMockFn(trpc.lineups.builder.useQuery).mockImplementation(
      (input: { gpId: string }) => ({
        data: builderData(input.gpId === GP1.id ? GP1 : GP2),
        isPending: false,
        isError: false,
      }),
    );
    asMockFn(trpc.lineups.get.useQuery).mockImplementation((input: { gpId: string }) => ({
      data: input.gpId === GP1.id ? LINEUP_GP1 : null,
      isPending: false,
      isError: false,
    }));
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    await user.selectOptions(screen.getByLabelText("Constructor"), "ctor-b");

    await user.selectOptions(screen.getByLabelText("GP"), GP2.id);
    await user.click(screen.getByRole("button", { name: "Sí, cambiar de GP" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("GP")).toHaveValue(GP2.id);
    // El trabajo sin guardado se descartó: el borrador de GP2 empieza vacío
    // y sin el destaque dirty.
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("");
    expect(screen.getByLabelText("Constructor")).toHaveValue("");
    expect(screen.getByText("Si guardas ahora:")).not.toHaveClass("status-dirty");
  });

  it("cambiar de temporada con borrador dirty: confirma y al confirmar cambia y limpia", async () => {
    mockSeasons();
    // 2026 sin GPs: tras confirmar, la página no puede pre-seleccionar GP.
    asMockFn(trpc.seasons.gps.list.useQuery).mockImplementation(
      (input: { seasonId: string }) => ({
        data: input.seasonId === SEASON_ID ? [] : [GP1, GP2],
        isPending: false,
        isError: false,
      }),
    );
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    // La pre-selección abre en 2027 + GP1 y el borrador sale prellenado
    // con el lineup guardado.
    expect(screen.getByLabelText("Temporada")).toHaveValue("season-2027");
    expect(screen.getByLabelText("GP")).toHaveValue(GP1.id);
    await user.selectOptions(screen.getByLabelText("Constructor"), "ctor-b");
    expect(screen.getByText("Si guardas ahora:")).toHaveClass("status-dirty");

    // Intentar cambiar de temporada: confirmación con impacto escrito (F3
    // P1-1) — el trabajo del fan no se pierde en silencio.
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Cambiar de temporada" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Los cambios del borrador que no hayas guardado se perderán.",
      ),
    ).toBeInTheDocument();

    // Confirmar: cambia de temporada, descarta el GP (2026 no tiene) y
    // limpia el borrador sin guardar.
    await user.click(
      within(dialog).getByRole("button", { name: "Sí, cambiar de temporada" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Temporada")).toHaveValue(SEASON_ID);
    expect(screen.getByLabelText("GP")).toHaveValue("");
    // 2026 no tiene GPs: la página nombra el estado real (F3 P3).
    expect(
      screen.getByText("Esta temporada no tiene GPs programados todavía."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Si guardas ahora:"),
    ).not.toBeInTheDocument();
  });

  it("borrador dirty: el navegador avisa al salir (beforeunload); limpio, no", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    const beforeUnloadBlocked = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    // Borrador igual al guardado: sin aviso.
    expect(beforeUnloadBlocked()).toBe(false);

    // Con cambios sin guardar: el navegador puede interceptar la salida.
    await user.selectOptions(screen.getByLabelText("Constructor"), "ctor-b");
    expect(beforeUnloadBlocked()).toBe(true);

    // Descartados los cambios: el aviso se retira.
    await user.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(beforeUnloadBlocked()).toBe(false);
  });

  it("borrador NUEVO (sin lineup guardado): el navegador avisa al salir", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    const beforeUnloadBlocked = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    // Borrador vacío: sin aviso.
    expect(beforeUnloadBlocked()).toBe(false);

    // Trabajo en curso (slots rellenados, sin lineup guardado): el navegador
    // puede interceptar la salida (F3 P1-1).
    await user.selectOptions(screen.getByLabelText("Piloto oro 1"), "r1");
    expect(beforeUnloadBlocked()).toBe(true);
  });

  it("muestra 'Consultando…' mientras el builder y el lineup cargan", async () => {
    mockSeasons();
    mockGps();
    // builder y lineup quedan pendientes (mock por defecto).
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
    await user.selectOptions(screen.getByLabelText("GP"), GP1.id);

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra un error si el builder del GP falla", async () => {
    mockSeasons();
    mockGps();
    const refetch = vi.fn();
    mockResult(trpc.lineups.builder.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
      refetch,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
    await user.selectOptions(screen.getByLabelText("GP"), GP1.id);

    expect(screen.getByText("No se pudo cargar el mercado del GP.")).toBeInTheDocument();
    // Barrido P3: el error es accionable — reintentar sin recargar la página.
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("F3 P2: muestra un aviso si el lineup guardado no se puede cargar", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockResult(trpc.lineups.get.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
    await user.selectOptions(screen.getByLabelText("GP"), GP1.id);

    expect(
      screen.getByText(
        "No se pudo cargar tu lineup guardado; el borrador parte de vacío.",
      ),
    ).toBeInTheDocument();
  });

  it("F3 P2: muestra un aviso si el historial de cambios no se puede cargar", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    mockResult(trpc.lineups.history.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
    await user.selectOptions(screen.getByLabelText("GP"), GP1.id);

    expect(
      screen.getByText("No se pudo cargar el historial de cambios de este GP."),
    ).toBeInTheDocument();
  });

  it("F3 P2: muestra el plazo de cierre y un aviso cuando falta poco (≤ 30 min)", async () => {
    mockSeasons();
    mockGps();
    // Lockout dentro de 10 minutos: la ventana sigue abierta pero el deadline
    // es el dato central (F3 P2: se lee ANTES de que el lockout lo oculte).
    mockBuilder(GP1, { lockoutAt: new Date(Date.now() + 10 * 60_000) });
    mockLineup(LINEUP_GP1);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);
    await user.selectOptions(screen.getByLabelText("GP"), GP1.id);

    // El plazo de cierre se lee en la lista de estado (siempre, no solo al bloquear).
    expect(screen.getByText(/Cierre de cambios:/)).toBeInTheDocument();
    // Y un aviso cuando falta poco (≤ 30 min).
    expect(
      screen.getByText(/Cierre de cambios en \d+ min\./),
    ).toBeInTheDocument();
  });

  it("US-12: muestra el historial de cambios (tipo, coste antes→después, motivo)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    mockResult(trpc.lineups.history.useQuery, {
      data: [
        {
          id: "c1",
          type: "swap",
          assetType: "rider",
          assetId: "r5",
          costBefore: 80,
          costAfter: 100,
          reason: null,
          createdAt: new Date("2026-10-20T11:00:00Z"),
        },
        {
          id: "c1b",
          type: "gold_silver",
          assetType: "rider",
          assetId: "r3",
          costBefore: 100,
          costAfter: 100,
          reason: null,
          createdAt: new Date("2026-10-20T11:30:00Z"),
        },
        {
          id: "c2",
          type: "wildcard",
          assetType: null,
          assetId: null,
          costBefore: 100,
          costAfter: 80,
          reason: "Lesión confirmada",
          createdAt: new Date("2026-10-20T12:00:00Z"),
        },
        {
          id: "c3",
          type: "add",
          assetType: "rider",
          assetId: "r2",
          costBefore: 65,
          costAfter: 80,
          reason: null,
          createdAt: new Date("2026-10-20T12:30:00Z"),
        },
        {
          id: "c4",
          type: "remove",
          assetType: "constructor",
          assetId: "ctor-b",
          costBefore: 110,
          costAfter: 80,
          reason: null,
          createdAt: new Date("2026-10-20T12:45:00Z"),
        },
        {
          id: "c5",
          type: "swap",
          assetType: "team",
          assetId: "team-b",
          costBefore: 80,
          costAfter: 85.01,
          reason: null,
          createdAt: new Date("2026-10-20T13:00:00Z"),
        },
        // Entradas defensivas (tipos/activos fuera del modelo): se muestran
        // tal cual o sin activo, nunca rompen la página.
        {
          id: "c6",
          type: "legacy",
          assetType: null,
          assetId: null,
          costBefore: null,
          costAfter: null,
          reason: null,
          createdAt: new Date("2026-10-20T13:15:00Z"),
        },
        {
          id: "c7",
          type: "add",
          assetType: null,
          assetId: null,
          costBefore: null,
          costAfter: null,
          reason: null,
          createdAt: new Date("2026-10-20T13:30:00Z"),
        },
        {
          id: "c8",
          type: "gold_silver",
          assetType: null,
          assetId: null,
          costBefore: null,
          costAfter: null,
          reason: null,
          createdAt: new Date("2026-10-20T13:45:00Z"),
        },
        // Constructor y equipo que ya no están en el mercado → fallback al ID.
        {
          id: "c9",
          type: "remove",
          assetType: "constructor",
          assetId: "ctor-x",
          costBefore: null,
          costAfter: null,
          reason: null,
          createdAt: new Date("2026-10-20T13:50:00Z"),
        },
        {
          id: "c10",
          type: "swap",
          assetType: "team",
          assetId: "team-x",
          costBefore: null,
          costAfter: null,
          reason: null,
          createdAt: new Date("2026-10-20T13:55:00Z"),
        },
        // Tipo de activo fuera del modelo (ni piloto ni ctor ni equipo) → ID.
        {
          id: "c11",
          type: "swap",
          assetType: "driver",
          assetId: "drv-1",
          costBefore: null,
          costAfter: null,
          reason: null,
          createdAt: new Date("2026-10-20T14:00:00Z"),
        },
      ],
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByRole("heading", { level: 2, name: "Historial de cambios" }),
    ).toBeInTheDocument();
    // F3: verbos en español + nombre del activo (r5 no está en el mercado
    // actual → fallback al ID tal cual).
    expect(screen.getByText("Cambio de r5")).toBeInTheDocument();
    expect(screen.getByText(/coste 80 → 100/)).toBeInTheDocument();
    // Reasignación oro↔plata (gratis): coste invariable, piloto resuelto.
    expect(
      screen.getByText("Reasignación oro↔plata de Piloto Tres"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/coste 100 → 100/)).toHaveLength(1);
    // Wildcard (reset completo) con motivo.
    expect(screen.getByText("Wildcard (reset completo)")).toBeInTheDocument();
    expect(screen.getByText(/coste 100 → 80/)).toBeInTheDocument();
    expect(screen.getByText(/Lesión confirmada/)).toBeInTheDocument();
    // Alta de piloto / baja de constructor / cambio de equipo (resueltos).
    expect(screen.getByText("Alta de Piloto Dos")).toBeInTheDocument();
    expect(screen.getByText("Baja de Ctor B")).toBeInTheDocument();
    expect(screen.getByText("Cambio de Team B")).toBeInTheDocument();
    // Defensivas: tipo desconocido tal cual; verbo sin activo.
    expect(screen.getByText("legacy")).toBeInTheDocument();
    expect(screen.getByText("Alta")).toBeInTheDocument();
    expect(screen.getByText("Reasignación oro↔plata")).toBeInTheDocument();
    // Activos fuera del mercado actual o de tipo desconocido → ID tal cual
    // (nunca se oculta, nunca rompe la página).
    expect(screen.getByText("Baja de ctor-x")).toBeInTheDocument();
    expect(screen.getByText("Cambio de team-x")).toBeInTheDocument();
    expect(screen.getByText("Cambio de drv-1")).toBeInTheDocument();
    // `.status` (barrido P3): la bitácora usa la lista de estado del sistema.
    expect(screen.getByText("Cambio de r5").closest("ul")).toHaveClass("status");
    // Fecha CON HORA por entrada (F3 P2-1 + barrido P3): la bitácora dice el
    // QUÉ y el CUÁNDO; las 12 entradas caen el mismo día y se distinguen por
    // la hora (11:00 → 14:00 UTC). Se calcula con la misma llamada de la UI
    // para no depender del huso del entorno de test.
    const fechaHora = (iso: string) =>
      new Date(iso).toLocaleString("es-ES", {
        dateStyle: "short",
        timeStyle: "short",
      });
    for (const iso of [
      "2026-10-20T11:00:00Z",
      "2026-10-20T11:30:00Z",
      "2026-10-20T12:00:00Z",
      "2026-10-20T12:30:00Z",
      "2026-10-20T12:45:00Z",
      "2026-10-20T13:00:00Z",
      "2026-10-20T13:15:00Z",
      "2026-10-20T13:30:00Z",
      "2026-10-20T13:45:00Z",
      "2026-10-20T13:50:00Z",
      "2026-10-20T13:55:00Z",
      "2026-10-20T14:00:00Z",
    ]) {
      expect(screen.getByText(`· ${fechaHora(iso)}`)).toBeInTheDocument();
    }
  });

  it("historial: explica el vocabulario (alta/baja/cambio, reasignación, wildcard)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    mockResult(trpc.lineups.history.useQuery, {
      data: [
        {
          id: "c1",
          type: "wildcard",
          assetType: null,
          assetId: null,
          costBefore: 100,
          costAfter: 80,
          reason: null,
          createdAt: new Date("2026-10-20T12:00:00Z"),
        },
      ],
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByText(/Alta: un activo entra al lineup/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Reasignación oro↔plata: mover un piloto entre oro/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Exención: pase gratuito de los cambios de la temporada/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Wildcard: reset completo del lineup/),
    ).toBeInTheDocument();
    // La entrada lleva su fecha CON HORA (F3 P2-1 + barrido P3).
    // Se calcula con la misma llamada de la UI (no depende del huso de test).
    const fechaHora = new Date("2026-10-20T12:00:00Z").toLocaleString(
      "es-ES",
      { dateStyle: "short", timeStyle: "short" },
    );
    expect(screen.getByText(`· ${fechaHora}`)).toBeInTheDocument();
  });

  it("explica el vocabulario de estado (presupuesto, carry, saldo, cambios)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByText(/Presupuesto: base \+ carry/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Cambios restantes: movimientos/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Bloqueado \(lockout\): el GP ya no admite guardados/),
    ).toBeInTheDocument();
  });

  it("agrupa temporada y GP en .stack (gap del sistema)", async () => {
    mockSeasons();
    mockGps();
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);

    const stack = document.querySelector(".stack");
    expect(stack).not.toBeNull();
    expect(within(stack as HTMLElement).getByLabelText("Temporada")).toBeInTheDocument();
    expect(within(stack as HTMLElement).getByLabelText("GP")).toBeInTheDocument();
  });

  it("guardando: el bloqueo transitorio no lleva motivo escrito", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    mockResult(trpc.lineups.save.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);

    // isPending + composición completa: disabled nativo (transitorio), sin motivo.
    const button = screen.getByRole("button", { name: "Guardando…" });
    expect(button).toBeDisabled();
    expect(
      screen.queryByText(
        "Composición incompleta: faltan piloto oro 1, piloto oro 2, piloto plata 1, piloto plata 2, constructor, equipo.",
      ),
    ).not.toBeInTheDocument();
  });

  it("historial: sin mercado cargado, los activos caen al ID tal cual", async () => {
    mockSeasons();
    mockGps();
    // El builder falla: no hay mercado que resolver nombres contra.
    mockResult(trpc.lineups.builder.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    mockResult(trpc.lineups.get.useQuery, {
      data: null,
      isPending: false,
      isError: false,
    });
    mockResult(trpc.lineups.history.useQuery, {
      data: [
        {
          id: "c1",
          type: "gold_silver",
          assetType: "rider",
          assetId: "r3",
          costBefore: 100,
          costAfter: 100,
          reason: null,
          createdAt: new Date("2026-10-20T11:30:00Z"),
        },
      ],
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByText("Reasignación oro↔plata de r3"),
    ).toBeInTheDocument();
  });

  // ── F3 /lineups: wildcard accionable, borrador, empty states, precio a un
  //    vistazo ─────────────────────────────────────────────────────────────

  it("wildcard: disponible, con confirmación muta con el borrador y re-consulta", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    const mutate = vi.fn();
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    const { queryClient } = renderLineups(<LineupsPage />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    await openGp1(user);

    // F3 P1: el wildcard solo tiene sentido con un borrador DISTINTO del
    // guardado (con el prefill idéntico sería un no-op y el botón se bloquea).
    // Cambio de equipo dentro de presupuesto para marcar el borrador como sucio.
    await user.selectOptions(screen.getByLabelText("Equipo"), "team-b");

    // El estado lo explica ANTES de usarlo (F3: nunca un control sin lectura).
    expect(screen.getByText("disponible")).toBeInTheDocument();
    expect(screen.getByText("(1 por temporada)")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Usar wildcard" });
    expect(button).toBeEnabled();
    await user.click(button);

    // Confirmación con impacto escrito (F3: nunca window.confirm): el
    // diálogo nombra la acción y se confirma con su propio verbo.
    expect(
      screen.getByRole("heading", { name: "Usar tu wildcard de temporada" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "El lineup de este GP se reemplazará por tu borrador. Es tu único wildcard de la temporada y no consume cambios de este GP.",
      ),
    ).toBeInTheDocument();
    // `irreversible` (barrido P3): el impacto se muestra como aviso,
    // mismo tratamiento que /admin (recurso escaso + reescritura).
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El lineup de este GP se reemplazará por tu borrador.",
    );
    await user.click(screen.getByRole("button", { name: "Sí, usar wildcard" }));

    expect(mutate).toHaveBeenCalledWith({
      gpId: GP1.id,
      slots: {
        gold: ["r1", "r2"],
        silver: ["r3", "r4"],
        constructorId: "ctor-a",
        teamId: "team-b",
      },
    });

    await act(async () => {
      mutationOptions(trpc.lineups.wildcard.useMutation).onSuccess?.(
        undefined,
        // `variables` (2º arg, React Query v5): el GP de ENVÍO.
        {
          gpId: GP1.id,
          slots: {
            gold: ["r1", "r2"],
            silver: ["r3", "r4"],
            constructorId: "ctor-a",
            teamId: "team-b",
          },
        },
      );
    });

    expect(
      screen.getByText(
        "Wildcard aplicado: lineup reemplazado sin consumir cambios de este GP.",
      ),
    ).toBeInTheDocument();
    // Re-consulta lineup + historial + builder (los 3 quedan obsoletos).
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.get, { gpId: GP1.id }),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.history, { gpId: GP1.id }),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.builder, { gpId: GP1.id }),
    });
    vi.restoreAllMocks();
  });

  it("wildcard: el impacto nombra cuántos wildcards concede la temporada", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1, { wildcardsPerSeason: 2 });
    mockLineup(LINEUP_GP1);
    const mutate = vi.fn();
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    // F3 P1: borrador sucio (no-op bloqueado) — cambio de equipo.
    await user.selectOptions(screen.getByLabelText("Equipo"), "team-b");
    await user.click(screen.getByRole("button", { name: "Usar wildcard" }));

    // F3 P2-2: "único" solo es verdad con 1 por temporada; con 2, el
    // impacto lo nombra en plural.
    expect(
      screen.getByText(
        "El lineup de este GP se reemplazará por tu borrador. Son tus 2 wildcards de la temporada y no consume cambios de este GP.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "No, volver" }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("wildcard: cancelado en la confirmación, no muta", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    const mutate = vi.fn();
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    // F3 P1: borrador sucio (no-op bloqueado) — cambio de equipo.
    await user.selectOptions(screen.getByLabelText("Equipo"), "team-b");

    await user.click(screen.getByRole("button", { name: "Usar wildcard" }));

    // Cancelado en la opción segura («No, volver»): el diálogo cierra y la
    // mutación nunca se dispara.
    await user.click(screen.getByRole("button", { name: "No, volver" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("wildcard: fallo del servidor, error visible sin romper la página", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: clientError("El GP está bloqueado", { code: "PRECONDITION_FAILED" }),
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // El servidor es quien manda: el error llega tras el envío y la página
    // lo muestra (sin romper la vista del borrador).
    await act(async () => {
      mutationOptions(trpc.lineups.wildcard.useMutation).onError?.(
        clientError("El GP está bloqueado", { code: "PRECONDITION_FAILED" }),
      );
    });

    expect(screen.getByText("El GP está bloqueado")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("wildcard: fallo sin mensaje legible, mensaje por defecto", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: "fallo opaco",
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // Rechazo que no es un Error (sin mensaje): la página no se rompe y
    // muestra el motivo por defecto.
    await act(async () => {
      mutationOptions(trpc.lineups.wildcard.useMutation).onError?.(
        "fallo opaco",
      );
    });

    expect(
      screen.getByText("No se pudo aplicar el wildcard."),
    ).toBeInTheDocument();
  });

  it("wildcard: ya usado, el botón se bloquea con motivo escrito", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1, { wildcardsUsed: 1, wildcardsPerSeason: 1 });
    mockLineup(LINEUP_GP1);
    const mutate = vi.fn();
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    const confirmSpy = vi.spyOn(window, "confirm");
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // El estado lo explica (ya usado esta temporada) y el botón lleva motivo.
    expect(screen.getByText("ya usado")).toBeInTheDocument();
    expect(screen.getByText("esta temporada")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Usar wildcard" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Ya usaste tu wildcard esta temporada."),
    ).toBeInTheDocument();
    await user.click(button);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("wildcard: GP bloqueado, no muta (motivo de lockout en ambos controles)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1, { status: "locked" });
    mockLineup(LINEUP_GP1);
    const mutate = vi.fn();
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // El motivo de bloqueo se escribe junto a guardar Y al wildcard.
    expect(screen.getAllByText("El GP está bloqueado (lockout).")).toHaveLength(2);

    const button = screen.getByRole("button", { name: "Usar wildcard" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);

    expect(mutate).not.toHaveBeenCalled();
  });

  it("wildcard: borrador idéntico al guardado, el botón se bloquea (no-op)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    const mutate = vi.fn();
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // F3 P1: el prefill deja el borrador IGUAL al guardado → el wildcard
    // sería un no-op. El botón se bloquea con el motivo (el recurso escaso
    // no se gasta en silencio).
    const button = screen.getByRole("button", { name: "Usar wildcard" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        "El borrador es idéntico al lineup guardado: no hay que gastar el wildcard.",
      ),
    ).toBeInTheDocument();
    await user.click(button);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("wildcard: sin lineup guardado, el botón se bloquea (guardar es gratis)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    const mutate = vi.fn();
    mockResult(trpc.lineups.wildcard.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    await fillDraft(user);

    // F3 P1: sin lineup guardado, el wildcard no aporta nada que "Guardar
    // lineup" no haga gratis → el botón se bloquea con el motivo.
    const button = screen.getByRole("button", { name: "Usar wildcard" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        "Aún no has guardado un lineup para este GP: 'Guardar lineup' no consume el wildcard.",
      ),
    ).toBeInTheDocument();
    await user.click(button);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("descartar cambios: restaura el borrador al lineup guardado", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(LINEUP_GP1);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // El borrador llega igual al guardado: sin botón de descarte ni aviso.
    expect(
      screen.queryByRole("button", { name: "Descartar cambios" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("· cambios sin guardar"),
    ).not.toBeInTheDocument();

    // Un cambio de slot (constructor) ensucia el borrador.
    await user.selectOptions(screen.getByLabelText("Constructor"), "ctor-b");
    expect(screen.getByRole("button", { name: "Descartar cambios" })).toBeInTheDocument();
    // Destacada (status-dirty) con el marcador de cambios sin guardar.
    expect(screen.getByText("Si guardas ahora:")).toHaveClass("status-dirty");
    expect(screen.getByText("· cambios sin guardar")).toBeInTheDocument();
    // El coste en vivo sigue visible (10+15+20+25+30+5 = 105, saldo -5).
    expect(screen.getByText("coste 105")).toBeInTheDocument();
    // Sobrecoste con señal semántica (F3 P1-2): el exceso se nombra ANTES
    // de pulsar "Guardar", no después.
    expect(
      screen.getByText("· saldo -5 — excede el presupuesto en 5"),
    ).toHaveClass("bad");

    await user.click(screen.getByRole("button", { name: "Descartar cambios" }));

    // Vuelve al guardado (ctor-a): el coste vuelve a 80 (saldo 20) y la
    // fila pierde el destaque dirty.
    expect(screen.getByLabelText("Constructor")).toHaveValue("ctor-a");
    expect(
      screen.queryByRole("button", { name: "Descartar cambios" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("coste 80")).toBeInTheDocument();
    expect(screen.getByText("· saldo 20")).toBeInTheDocument();
    expect(screen.getByText("Si guardas ahora:")).not.toHaveClass("status-dirty");
  });

  it("barrido P3: borrador nuevo sin guardado → 'Limpiar borrador' vacía sin cambiar de GP", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // Borrador vacío: sin botón (no hay nada que limpiar).
    expect(
      screen.queryByRole("button", { name: "Limpiar borrador" }),
    ).not.toBeInTheDocument();

    // Un slot elegido: aparece la salida para vaciar el borrador NUEVO sin
    // pasar por "Cambiar de GP" (que exige confirmación).
    await user.selectOptions(screen.getByLabelText("Piloto oro 1"), "r1");
    const clear = screen.getByRole("button", { name: "Limpiar borrador" });
    await user.click(clear);

    // El borrador vuelve a vacío y el botón desaparece.
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Limpiar borrador" }),
    ).not.toBeInTheDocument();
    // Y el GP no ha cambiado (la salida no es un cambio de GP).
    expect(screen.getByLabelText("GP")).toHaveValue(GP1.id);
  });

  it("historial: sin cambios, la sección se explica (empty state)", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    mockResult(trpc.lineups.history.useQuery, {
      data: [],
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByRole("heading", { level: 2, name: "Historial de cambios" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sin cambios todavía en este GP.")).toBeInTheDocument();
  });

  it("historial: la razón exencion:<uuid> se traduce; la libre se muestra", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    mockResult(trpc.lineups.history.useQuery, {
      data: [
        {
          id: "c1",
          type: "remove",
          assetType: "rider",
          assetId: "r5",
          costBefore: 100,
          costAfter: 80,
          reason: "exencion:550e8400-e29b-41d4-a716-446655440000",
          createdAt: new Date("2026-10-20T11:00:00Z"),
        },
        {
          id: "c2",
          type: "swap",
          assetType: "rider",
          assetId: "r2",
          costBefore: 80,
          costAfter: 85,
          reason: "ajuste manual del admin",
          createdAt: new Date("2026-10-20T11:30:00Z"),
        },
      ],
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // r5 no está en el mercado del GP → nombre cae al ID (nunca se oculta).
    expect(screen.getByText("Baja de r5")).toBeInTheDocument();
    // El identificador interno se traduce; el crudo nunca se muestra.
    // (La etiqueta vive en un <span> con separador " — ": regex, no texto exacto.)
    expect(screen.getByText(/exención consumida/)).toBeInTheDocument();
    expect(screen.queryByText(/exencion:/)).not.toBeInTheDocument();
    // La razón libre del admin se muestra tal cual.
    expect(screen.getByText("Cambio de Piloto Dos")).toBeInTheDocument();
    expect(screen.getByText(/ajuste manual del admin/)).toBeInTheDocument();
    // Ambas entradas llevan su fecha CON HORA (F3 P2-1 + barrido P3).
    // Se calcula con la misma llamada de la UI (no depende del huso de test).
    const fechaHora = (iso: string) =>
      new Date(iso).toLocaleString("es-ES", {
        dateStyle: "short",
        timeStyle: "short",
      });
    expect(
      screen.getByText(`· ${fechaHora("2026-10-20T11:00:00Z")}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`· ${fechaHora("2026-10-20T11:30:00Z")}`),
    ).toBeInTheDocument();
  });

  it("precio a un vistazo: cada slot elegido muestra el precio del activo", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1);
    mockLineup(null);
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // Borrador vacío: sin líneas de precio (solo el texto de los <option>).
    expect(screen.queryByText("Precio: 10")).not.toBeInTheDocument();

    await fillDraft(user);

    expect(screen.getByText("Precio: 10")).toBeInTheDocument();
    expect(screen.getByText("Precio: 15")).toBeInTheDocument();
    expect(screen.getByText("Precio: 20")).toBeInTheDocument();
    expect(screen.getByText("Precio: 25")).toBeInTheDocument();
    // Constructor (5) y equipo (5): dos apariciones.
    expect(screen.getAllByText("Precio: 5")).toHaveLength(2);
  });

  it("precio a un vistazo: slot sin precio lo avisa; activo fuera del mercado, sin inventar", async () => {
    mockSeasons();
    mockGps();
    mockBuilder(GP1, {
      riders: [
        { riderId: "r1", name: "Piloto Uno", teamName: "Team A", constructorName: "Ctor A", price: 10 },
        { riderId: "r2", name: "Piloto Dos", teamName: "Team A", constructorName: "Ctor A", price: 15 },
        { riderId: "rx", name: "Piloto Sin Precio", teamName: "Team A", constructorName: "Ctor A", price: null },
      ],
      constructors: [{ id: "ctor-x", name: "Ctor X", price: null }],
      teams: [
        { id: "team-a", name: "Team A", constructorId: "ctor-x", constructorName: "Ctor X", price: 5 },
      ],
    });
    // Lineup guardado con un piloto (rx) y un constructor (ctor-x) sin
    // precio, un piloto fuera del mercado (ghost) y un equipo fuera (team-z).
    mockResult(trpc.lineups.get.useQuery, {
      data: {
        gpId: GP1.id,
        cost: 25,
        budget: 100,
        balance: 75,
        slots: {
          gold: ["rx", "r1"],
          silver: ["ghost", "r2"],
          constructorId: "ctor-x",
          teamId: "team-z",
        },
        usedChanges: 0,
        remainingChanges: 2,
        updatedAt: new Date("2026-10-20T10:00:00Z"),
      },
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    // rx y ctor-x sin precio: aviso en su slot (2 apariciones).
    expect(screen.getAllByText("Sin precio para este GP.")).toHaveLength(2);
    // ghost y team-z no están en el mercado: sin precio inventado.
    expect(screen.queryByText("Precio: 5")).not.toBeInTheDocument();
    // Los que sí tienen precio lo muestran.
    expect(screen.getByText("Precio: 10")).toBeInTheDocument();
    expect(screen.getByText("Precio: 15")).toBeInTheDocument();
  });
});
