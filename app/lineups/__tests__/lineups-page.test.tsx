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
const GP1 = { id: "gp-1", name: "GP de Jerez", round: 1 };
const GP2 = { id: "gp-2", name: "GP de Portugal", round: 2 };

const RIDERS = [
  { riderId: "r1", name: "Piloto Uno", teamName: "Team A", constructorName: "Ctor A", price: 10 },
  { riderId: "r2", name: "Piloto Dos", teamName: "Team A", constructorName: "Ctor A", price: 15 },
  { riderId: "r3", name: "Piloto Tres", teamName: "Team B", constructorName: "Ctor B", price: 20 },
  { riderId: "r4", name: "Piloto Cuatro", teamName: "Team B", constructorName: "Ctor B", price: 25 },
  { riderId: "rx", name: "Piloto Sin Precio", teamName: "Team A", constructorName: "Ctor A", price: null },
];
const CONSTRUCTORS = [
  { id: "ctor-a", name: "Ctor A", price: 5 },
  { id: "ctor-b", name: "Ctor B", price: 30 },
];
const TEAMS = [
  { id: "team-a", name: "Team A", constructorId: "ctor-a", constructorName: "Ctor A", price: 5 },
  { id: "team-b", name: "Team B", constructorId: "ctor-b", constructorName: "Ctor B", price: 5.01 },
];

/** Presupuesto por defecto del builder (primer GP, sin carry). */
const BUDGET = { base: 100, carry: 0, total: 100 };

/** Datos del builder para un GP (el mismo mercado para ambos GPs de prueba). */
function builderData(
  gp: typeof GP1,
  overrides: {
    status?: string;
    lockoutAt?: Date | null;
    budget?: typeof BUDGET;
  } = {},
) {
  return {
    gp: {
      ...gp,
      status: overrides.status ?? "scheduled",
      lockoutAt: overrides.lockoutAt ?? null,
    },
    budget: overrides.budget ?? BUDGET,
    riders: RIDERS,
    constructors: CONSTRUCTORS,
    teams: TEAMS,
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

function mockBuilder(
  gp: typeof GP1,
  overrides?: {
    status?: string;
    lockoutAt?: Date | null;
    budget?: typeof BUDGET;
  },
) {
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
  onSuccess?: (result: unknown) => void;
  onError?: (err: Error) => void;
} {
  const calls = asMockFn(hook).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as {
    onSuccess?: (result: unknown) => void;
    onError?: (err: Error) => void;
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
    expect(
      screen.getByText("No se pudo cargar la lista de temporadas."),
    ).toBeInTheDocument();
  });

  it("muestra la selección de temporada y GP y pide un GP si no se elige", async () => {
    mockSeasons();
    mockGps();
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), SEASON_ID);

    expect(
      screen.getByText("Selecciona un GP para componer tu lineup."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "J1 · GP de Jerez" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar lineup" }),
    ).not.toBeInTheDocument();
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
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("Cambios restantes:")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    // Prefill desde el lineup guardado.
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("r1");
    expect(screen.getByLabelText("Piloto oro 2")).toHaveValue("r2");
    expect(screen.getByLabelText("Piloto plata 1")).toHaveValue("r3");
    expect(screen.getByLabelText("Piloto plata 2")).toHaveValue("r4");
    expect(screen.getByLabelText("Constructor")).toHaveValue("ctor-a");
    expect(screen.getByLabelText("Equipo")).toHaveValue("team-a");
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
    expect(screen.getByText("Coste del borrador:")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    // 10 + 15 + 20 + 25 + 5 (constructor) + 5 (equipo) = 80.
    await fillDraft(user);
    expect(screen.getByText("80")).toBeInTheDocument();
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

    // Elegido en oro 1 → deshabilitado en el resto de slots (no en el suyo).
    await user.selectOptions(gold1, "r1");
    expect(
      within(screen.getByLabelText("Piloto oro 2")).getByRole("option", {
        name: "Piloto Uno (Team A) — 10",
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
    expect(button).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Piloto oro 1"), "r1");
    expect(button).toBeDisabled();

    await fillDraft(user);
    expect(button).toBeEnabled();
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
      mutationOptions(trpc.lineups.save.useMutation).onSuccess?.({
        gpId: GP1.id,
        cost: 80,
        budget: 100,
        balance: 20,
        changesApplied: 0,
        remainingChanges: 1,
        firstSave: true,
      });
    });

    expect(
      screen.getByText("Lineup guardado para GP de Jerez. Cambios restantes: 1."),
    ).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.lineups.get, { gpId: GP1.id }),
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
      screen.getByText(
        "El GP está cerrado (lockout): no se pueden guardar lineups.",
      ),
    ).toBeInTheDocument();

    await fillDraft(user);
    expect(
      screen.getByRole("button", { name: "Guardar lineup" }),
    ).toBeDisabled();
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
      screen.getByText(
        "El GP está cerrado (lockout): no se pueden guardar lineups.",
      ),
    ).toBeInTheDocument();
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
    asMockFn(trpc.lineups.get.useQuery).mockImplementation(
      (input: { gpId: string }) => ({
        data: input.gpId === GP1.id ? LINEUP_GP1 : null,
        isPending: false,
        isError: false,
      }),
    );
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("r1");

    await user.selectOptions(screen.getByLabelText("GP"), GP2.id);

    // GP2 sin lineup: borrador vacío y coste en vivo de nuevo.
    expect(screen.getByLabelText("Piloto oro 1")).toHaveValue("");
    expect(screen.getByText("Coste del borrador:")).toBeInTheDocument();
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
    mockResult(trpc.lineups.builder.useQuery, {
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
      screen.getByText("No se pudo cargar el mercado del GP."),
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
      ],
      isPending: false,
      isError: false,
    });
    renderLineups(<LineupsPage />);

    const user = userEvent.setup();
    await openGp1(user);

    expect(
      screen.getByRole("heading", { level: 3, name: "Historial de cambios" }),
    ).toBeInTheDocument();
    // Cambio swap con coste antes→después.
    expect(screen.getByText(/swap rider r5/)).toBeInTheDocument();
    expect(screen.getByText(/coste 80 → 100/)).toBeInTheDocument();
    // Reasignación oro↔plata (gratis): coste invariable.
    expect(
      screen.getByText(/Reasignación oro↔plata \(r3\)/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/coste 100 → 100/)).toHaveLength(1);
    // Wildcard (reset completo) con motivo.
    expect(screen.getByText(/Wildcard \(reset completo\)/)).toBeInTheDocument();
    expect(screen.getByText(/coste 100 → 80/)).toBeInTheDocument();
    expect(screen.getByText(/Lesión confirmada/)).toBeInTheDocument();
  });
});
