// @vitest-environment jsdom
/**
 * Tests de `app/ligas/ligas-page.tsx` (US-23, leagues.md §3; US-24,
 * leagues.md §2):
 * - Mis ligas (nombre, tipo, miembros, admin) → enlace al detalle.
 * - Directorio de ligas públicas (US-24): lista, vacío, error, enlaces.
 * - Formulario de creación (nombre/descripción/tipo/visibilidad/min-máx/
 *   modo de entrada/duración) → `leagues.create` con el payload correcto.
 * - Éxito: la liga creada + enlace al detalle.
 * - Error: el mensaje del servidor.
 *
 * La rotación de código (leagues.md §4) vive en el detalle (US-24) y se
 * cubre en `__tests__/league-detail-page.test.tsx`.
 *
 * Sobre el `trpc` mockeado (test/trpc-mock): los callbacks de éxito/error
 * de las mutations se invocan manualmente (patrón de los tests de lineups).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { act, render, screen, userEvent } from "../../../test/rtl";

import LigasPage from "../ligas-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

const LEAGUE = {
  id: "league-1",
  name: "Liga de los amigos",
  description: "Solo para la familia",
  type: "private",
  visibility: "private",
  minMembers: 2,
  maxMembers: 50,
  entryMode: "code",
  adjustedRankingEnabled: false,
  startDate: null,
  endDate: null,
  activeMembers: 3,
  members: [{ username: "piloto1", role: "admin" }],
  isAdmin: true,
  code: "ABC123XYZ9",
};

const PUBLIC_LEAGUE = {
  id: "pub-1",
  name: "Liga pública general",
  description: "Comunidad abierta",
  type: "public",
  minMembers: 2,
  maxMembers: 50,
  entryMode: "mixed",
  activeMembers: 12,
  createdAt: new Date("2026-10-01T00:00:00Z"),
};

const PUBLIC_LEAGUE_INVITE = {
  id: "pub-2",
  name: "Liga por invitación",
  description: null,
  type: "public",
  minMembers: 2,
  maxMembers: 10,
  entryMode: "invite",
  activeMembers: 3,
  createdAt: new Date("2026-10-02T00:00:00Z"),
};

function renderLigas(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockMyLeagues(data: unknown) {
  mockResult(trpc.leagues.myLeagues.useQuery, {
    data,
    isPending: false,
    isError: false,
  });
}

function mockPublicLeagues(data: unknown, isError = false) {
  mockResult(trpc.leagues.listPublic.useQuery, {
    data,
    isPending: false,
    isError,
    error: isError ? new Error("fallo") : undefined,
  });
}

/** Mockea una mutation y devuelve el `mutate` (para inspeccionar el input). */
function mockMutation(hook: unknown): ReturnType<typeof vi.fn> {
  const mutate = vi.fn();
  mockResult(hook, {
    mutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: undefined,
    data: undefined,
  });
  return mutate;
}

/**
 * Opciones de la mutation (onSuccess/onError) de la ÚLTIMA invocación del
 * hook: las opciones de renders anteriores cierran sobre estado viejo.
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

describe("LigasPage (US-23/US-24)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    mockPublicLeagues([PUBLIC_LEAGUE, PUBLIC_LEAGUE_INVITE]);
  });

  it("muestra el estado pendiente de mis ligas", () => {
    mockResult(trpc.leagues.myLeagues.useQuery, {
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderLigas(<LigasPage />);
    expect(screen.getAllByText("Consultando…").length).toBeGreaterThan(0);
  });

  it("muestra un error si la lista de ligas falla", () => {
    mockResult(trpc.leagues.myLeagues.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderLigas(<LigasPage />);
    expect(
      screen.getByText("No se pudo cargar tu lista de ligas."),
    ).toBeInTheDocument();
  });

  it("muestra el vacío elegante si no hay ligas propias", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);
    expect(
      screen.getByText(/Todavía no estás en ninguna liga/),
    ).toBeInTheDocument();
  });

  it("muestra mis ligas con tipo, miembros, admin y enlace al detalle", () => {
    mockMyLeagues([LEAGUE]);
    renderLigas(<LigasPage />);

    expect(screen.getByText("Liga de los amigos")).toBeInTheDocument();
    expect(screen.getByText(/privada · 3 miembros/)).toBeInTheDocument();
    expect(screen.getByText("· admin")).toBeInTheDocument();
    // Enlace al detalle (US-24): el código ya no se muestra en la lista.
    const link = screen.getByRole("link", { name: "Liga de los amigos" });
    expect(link).toHaveAttribute("href", "/ligas/league-1");
    expect(screen.queryByText("ABC123XYZ9")).not.toBeInTheDocument();
  });

  it("muestra el directorio de ligas públicas (US-24) con enlace", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    expect(screen.getByText("Liga pública general")).toBeInTheDocument();
    expect(screen.getByText(/Comunidad abierta/)).toBeInTheDocument();
    expect(screen.getByText(/12\/50 miembros/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Liga pública general" });
    expect(link).toHaveAttribute("href", "/ligas/pub-1");
  });

  it("enlaza a la unión por código (/unirse, US-25)", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const link = screen.getByRole("link", { name: "Únete a una liga" });
    expect(link).toHaveAttribute("href", "/unirse");
  });

  it("muestra el modo de entrada legible de cada liga del directorio", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    // mixed → "código o invitación"; invite → "solo invitación" (leagues.md §3).
    expect(screen.getByText(/código o invitación/)).toBeInTheDocument();
    expect(screen.getByText(/solo invitación/)).toBeInTheDocument();
  });

  it("muestra el vacío del directorio si no hay públicas", () => {
    mockMyLeagues([]);
    mockPublicLeagues([]);
    renderLigas(<LigasPage />);
    expect(
      screen.getByText(/Todavía no hay ligas públicas/),
    ).toBeInTheDocument();
  });

  it("muestra un error si el directorio falla", () => {
    mockMyLeagues([]);
    mockPublicLeagues(undefined, true);
    renderLigas(<LigasPage />);
    expect(
      screen.getByText("No se pudo cargar el directorio de ligas."),
    ).toBeInTheDocument();
  });

  it("muestra el formulario de creación con los campos de leagues.md §3", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.getByLabelText("Descripción (opcional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Tipo")).toBeInTheDocument();
    expect(screen.getByLabelText("Visibilidad")).toBeInTheDocument();
    expect(screen.getByLabelText("Miembros mínimos")).toBeInTheDocument();
    expect(screen.getByLabelText("Miembros máximos")).toBeInTheDocument();
    expect(screen.getByLabelText("Modo de entrada")).toBeInTheDocument();
    expect(screen.getByLabelText("Inicio (opcional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Fin (opcional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear liga" })).toBeInTheDocument();
  });

  it("muestra el ranking ajustado desactivado por defecto (US-30, D-10)", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const checkbox = screen.getByLabelText(/Ranking ajustado/);
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
    expect(
      screen.getByText(
        /El ranking general contará solo los GPs desde la entrada del último miembro/,
      ),
    ).toBeInTheDocument();
  });

  it("desactiva el botón de creación sin nombre", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);
    expect(screen.getByRole("button", { name: "Crear liga" })).toBeDisabled();
  });

  it("envía el payload de creación al enviar el formulario", async () => {
    mockMyLeagues([]);
    const mutate = mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga de prueba");
    await user.type(screen.getByLabelText("Descripción (opcional)"), "Descripción");
    await user.selectOptions(screen.getByLabelText("Tipo"), "public");
    await user.selectOptions(screen.getByLabelText("Visibilidad"), "public");
    await user.selectOptions(screen.getByLabelText("Modo de entrada"), "invite");
    await user.clear(screen.getByLabelText("Miembros mínimos"));
    await user.type(screen.getByLabelText("Miembros mínimos"), "3");
    await user.clear(screen.getByLabelText("Miembros máximos"));
    await user.type(screen.getByLabelText("Miembros máximos"), "20");
    await user.click(screen.getByRole("button", { name: "Crear liga" }));

    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      name: "Liga de prueba",
      description: "Descripción",
      type: "public",
      visibility: "public",
      minMembers: 3,
      maxMembers: 20,
      entryMode: "invite",
      adjustedRankingEnabled: false,
    });
  });

  it("envía el ranking ajustado activado si el admin lo marca (US-30)", async () => {
    mockMyLeagues([]);
    const mutate = mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga ajustada");
    await user.click(screen.getByLabelText(/Ranking ajustado/));
    await user.click(screen.getByRole("button", { name: "Crear liga" }));

    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      name: "Liga ajustada",
      adjustedRankingEnabled: true,
    });
  });

  it("tras el éxito muestra la liga creada con enlace al detalle", async () => {
    mockMyLeagues([]);
    mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga nueva");
    await user.click(screen.getByRole("button", { name: "Crear liga" }));

    await act(async () => {
      mutationOptions(trpc.leagues.create.useMutation).onSuccess?.({
        ...LEAGUE,
        name: "Liga nueva",
        id: "new-1",
      });
    });

    expect(screen.getByText(/Liga «Liga nueva» creada\./)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ver detalle" });
    expect(link).toHaveAttribute("href", "/ligas/new-1");
  });

  it("si la creación falla muestra el motivo del servidor", async () => {
    mockMyLeagues([]);
    mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga inválida");
    await user.click(screen.getByRole("button", { name: "Crear liga" }));

    await act(async () => {
      mutationOptions(trpc.leagues.create.useMutation).onError?.(
        new Error("El máximo de miembros no puede superar 50."),
      );
    });

    expect(
      screen.getByText("El máximo de miembros no puede superar 50."),
    ).toBeInTheDocument();
  });
});
