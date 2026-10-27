// @vitest-environment jsdom
/**
 * Tests de `app/ligas/[id]/league-detail-page.tsx` (US-24, leagues.md
 * §8/§9; pantalla 10 de user-flows):
 * - Info de la liga (nombre, descripción, tipo, miembros, modo de entrada).
 * - Miembros (seudónimos, admin marcado).
 * - Ranking general (filas, vacío elegante).
 * - Panel de admin (código + rotación) solo si el actor es admin.
 * - Rotación de código (leagues.md §4): éxito con el nuevo código; error del
 *   servidor.
 * - NOT_FOUND (liga inexistente o privada a un extraño): mensaje + enlace de
 *   vuelta (no se revela la existencia, US-24 CA).
 *
 * Sobre el `trpc` mockeado (test/trpc-mock) y `next/navigation` mockeado
 * (test/ui-mocks, `useParams` con `navigation.params`).
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asMockFn, mockResult, resetTrpcMocks } from "../../../../test/trpc-mock";
import { act, cleanup, render, screen, userEvent } from "../../../../test/rtl";
import { navigation, resetNavigationMocks } from "../../../../test/ui-mocks";

import LeagueDetailPage from "../league-detail-page";

vi.mock("@/trpc/client", () => import("../../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../../test/ui-mocks").then((m) => m.navigationMock),
);

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
  allowMemberInvites: false,
  startDate: null,
  endDate: null,
  activeMembers: 2,
  members: [
    { userId: "user-1", username: "piloto1", role: "admin" },
    { userId: "user-2", username: "piloto2", role: "member" },
  ],
  isAdmin: true,
  isMember: true,
  code: "ABC123XYZ9",
};

const RANKING = {
  entries: [
    { position: 1, username: "piloto1", points: 170.5 },
    { position: 2, username: "piloto2", points: 120 },
  ],
  computedAt: new Date("2026-10-25T12:00:00Z"),
  resultsVersion: "v1",
};

function renderDetail(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockLeague(data: unknown, isError = false) {
  mockResult(trpc.leagues.get.useQuery, {
    data,
    isPending: false,
    isError,
    error: isError ? new Error("La liga no existe.") : undefined,
  });
}

function mockRanking(data: unknown) {
  mockResult(trpc.leagues.ranking.useQuery, {
    data,
    isPending: false,
    isError: false,
  });
}

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

function mutationOptions(hook: unknown): {
  // `onSuccess` puede declarar 0 argumentos (la página ignora el resultado);
  // `...args` permite llamarla con 0 o N argumentos en el test.
  onSuccess?: (...args: unknown[]) => void;
  onError?: (err: Error) => void;
} {
  const calls = asMockFn(hook).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as {
    onSuccess?: (...args: unknown[]) => void;
    onError?: (err: Error) => void;
  };
}

describe("LeagueDetailPage (US-24)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
    navigation.params = { id: "league-1" };
  });

  it("muestra el estado pendiente", () => {
    mockResult(trpc.leagues.get.useQuery, {
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderDetail(<LeagueDetailPage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("NOT_FOUND: muestra el mensaje y el enlace de vuelta (no revela existencia)", () => {
    mockLeague(undefined, true);
    renderDetail(<LeagueDetailPage />);
    expect(screen.getByText("La liga no existe.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al directorio" })).toHaveAttribute(
      "href",
      "/ligas",
    );
  });

  it("muestra la info de la liga (nombre, descripción, tipo, miembros, modo)", () => {
    mockLeague(LEAGUE);
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);

    expect(screen.getByText("Liga de los amigos")).toBeInTheDocument();
    expect(screen.getByText("Solo para la familia")).toBeInTheDocument();
    // "Privada ·" (info de la liga) — el select de visibilidad también tiene
    // una opción "Privada", así que el patrón incluye el separador.
    expect(screen.getByText(/Privada ·/)).toBeInTheDocument();
    expect(screen.getByText(/2\/50 miembros/)).toBeInTheDocument();
    expect(screen.getByText(/por código/)).toBeInTheDocument();
  });

  it("muestra el modo de entrada legible (invite y mixed)", () => {
    mockLeague({ ...LEAGUE, entryMode: "invite" });
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);
    expect(screen.getByText(/solo invitación/)).toBeInTheDocument();

    cleanup();
    mockResult(trpc.leagues.get.useQuery, {
      data: { ...LEAGUE, entryMode: "mixed" },
      isPending: false,
      isError: false,
    });
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);
    expect(screen.getByText(/código o invitación/)).toBeInTheDocument();
  });

  it("muestra los miembros con seudónimo y admin marcado", () => {
    mockLeague(LEAGUE);
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);

    // "piloto1" aparece en miembros y en ranking: al menos una vez en cada.
    expect(screen.getAllByText("piloto1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("piloto2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("· admin")).toBeInTheDocument();
    // El seudónimo nunca es un email (leagues.md §9).
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("muestra el ranking general (posición, seudónimo, puntos)", () => {
    mockLeague(LEAGUE);
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);

    // Los puntos son únicos del ranking (los miembros no los muestran).
    expect(screen.getByText(/170\.5 pts/)).toBeInTheDocument();
    expect(screen.getByText(/120 pts/)).toBeInTheDocument();
  });

  it("muestra el vacío elegante del ranking si no hay filas", () => {
    mockLeague(LEAGUE);
    mockRanking({ entries: [], computedAt: null, resultsVersion: null });
    renderDetail(<LeagueDetailPage />);

    expect(
      screen.getByText(/Aún no hay ranking publicado/),
    ).toBeInTheDocument();
  });

  it("muestra el vacío elegante si la liga no tiene miembros", () => {
    mockLeague({ ...LEAGUE, activeMembers: 0, members: [] });
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);

    expect(screen.getByText("Todavía no hay miembros.")).toBeInTheDocument();
  });

  it("muestra un error si el ranking falla", () => {
    mockLeague(LEAGUE);
    mockResult(trpc.leagues.ranking.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderDetail(<LeagueDetailPage />);

    expect(screen.getByText("No se pudo cargar el ranking.")).toBeInTheDocument();
  });

  it("admin sin código (modo invitación): avisa que la liga no usa código", () => {
    mockLeague({ ...LEAGUE, code: null });
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);

    expect(
      screen.getByText(/Esta liga no usa código de invitación/),
    ).toBeInTheDocument();
    // Sin código no hay botón de rotar.
    expect(
      screen.queryByRole("button", { name: "Rotar código" }),
    ).not.toBeInTheDocument();
  });

  it("admin: muestra el código y el botón de rotar", () => {
    mockLeague(LEAGUE);
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);

    expect(screen.getByText("ABC123XYZ9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotar código" })).toBeInTheDocument();
  });

  it("no admin: no muestra el panel de administración ni el código", () => {
    mockLeague({ ...LEAGUE, isAdmin: false, code: null });
    mockRanking(RANKING);
    renderDetail(<LeagueDetailPage />);

    expect(screen.queryByRole("button", { name: "Rotar código" })).not.toBeInTheDocument();
    expect(screen.queryByText("ABC123XYZ9")).not.toBeInTheDocument();
  });

  it("rota el código y muestra el nuevo (leagues.md §4)", async () => {
    mockLeague(LEAGUE);
    mockRanking(RANKING);
    const mutate = mockMutation(trpc.leagues.rotateCode.useMutation);
    renderDetail(<LeagueDetailPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rotar código" }));

    expect(mutate.mock.calls[0]?.[0]).toEqual({ leagueId: "league-1" });

    await act(async () => {
      mutationOptions(trpc.leagues.rotateCode.useMutation).onSuccess?.(
        "NUEVO456CD7",
      );
    });

    // El aviso se divide en texto + <strong> con el nuevo código.
    expect(
      screen.getByText(/Código rotado. El código anterior quedó revocado/),
    ).toBeInTheDocument();
    expect(screen.getByText("NUEVO456CD7")).toBeInTheDocument();
  });

  it("si la rotación falla muestra el motivo del servidor", async () => {
    mockLeague(LEAGUE);
    mockRanking(RANKING);
    mockMutation(trpc.leagues.rotateCode.useMutation);
    renderDetail(<LeagueDetailPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rotar código" }));

    await act(async () => {
      mutationOptions(trpc.leagues.rotateCode.useMutation).onError?.(
        new Error("Solo el admin de la liga puede hacer esta acción."),
      );
    });

    expect(
      screen.getByText("Solo el admin de la liga puede hacer esta acción."),
    ).toBeInTheDocument();
  });

  describe("unión a la liga pública (US-25, ADR-0025)", () => {
    const PUBLIC_LEAGUE = {
      ...LEAGUE,
      id: "pub-1",
      type: "public",
      visibility: "public",
      isAdmin: false,
      isMember: false,
      code: null,
      members: [{ userId: "user-9", username: "fundador", role: "admin" }],
    };

    function mockMe(isError = false) {
      mockResult(trpc.auth.me.useQuery, {
        data: isError ? undefined : { username: "yo", email: "yo@liga.com", roles: [] },
        isPending: false,
        isError,
        error: isError ? new Error("No estás autenticado") : undefined,
      });
    }

    it("pública + autenticado + no miembro: muestra el botón de unión", () => {
      mockLeague(PUBLIC_LEAGUE);
      mockRanking(RANKING);
      mockMe();
      renderDetail(<LeagueDetailPage />);

      expect(
        screen.getByRole("button", { name: "Unirme a la liga" }),
      ).toBeInTheDocument();
    });

    it("pública + sin sesión: ofrece iniciar sesión (unirse exige cuenta)", () => {
      mockLeague(PUBLIC_LEAGUE);
      mockRanking(RANKING);
      mockMe(true);
      renderDetail(<LeagueDetailPage />);

      expect(screen.getByText(/Para unirte a la liga necesitas una cuenta/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
        "href",
        "/login",
      );
      expect(
        screen.queryByRole("button", { name: "Unirme a la liga" }),
      ).not.toBeInTheDocument();
    });

    it("pública + ya miembro: no muestra el botón de unión", () => {
      mockLeague({ ...PUBLIC_LEAGUE, isMember: true });
      mockRanking(RANKING);
      mockMe();
      renderDetail(<LeagueDetailPage />);

      expect(
        screen.queryByRole("button", { name: "Unirme a la liga" }),
      ).not.toBeInTheDocument();
    });

    it("privada: no muestra el botón de unión (se une por código en /unirse)", () => {
      mockLeague(LEAGUE);
      mockRanking(RANKING);
      mockMe();
      renderDetail(<LeagueDetailPage />);

      expect(
        screen.queryByRole("button", { name: "Unirme a la liga" }),
      ).not.toBeInTheDocument();
    });

    it("clic en unirse: envía la leagueId (entrada abierta)", async () => {
      mockLeague(PUBLIC_LEAGUE);
      mockRanking(RANKING);
      mockMe();
      const mutate = mockMutation(trpc.leagues.join.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Unirme a la liga" }));

      expect(mutate.mock.calls[0]?.[0]).toEqual({ leagueId: "pub-1" });
    });

    it("si la unión falla muestra el motivo del servidor", async () => {
      mockLeague(PUBLIC_LEAGUE);
      mockRanking(RANKING);
      mockMe();
      mockMutation(trpc.leagues.join.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Unirme a la liga" }));

      await act(async () => {
        mutationOptions(trpc.leagues.join.useMutation).onError?.(
          new Error("La liga está llena."),
        );
      });

      expect(screen.getByText("La liga está llena.")).toBeInTheDocument();
    });

    it("si la unión tiene éxito no muestra error (invalida la vista de la liga)", async () => {
      mockLeague(PUBLIC_LEAGUE);
      mockRanking(RANKING);
      mockMe();
      mockMutation(trpc.leagues.join.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Unirme a la liga" }));

      await act(async () => {
        mutationOptions(trpc.leagues.join.useMutation).onSuccess?.(
          { ...PUBLIC_LEAGUE, isMember: true },
        );
      });

      expect(screen.queryByText("La liga está llena.")).not.toBeInTheDocument();
    });

    it("pública + sesión pendiente: muestra 'Consultando…' en la sección de unión", () => {
      mockLeague(PUBLIC_LEAGUE);
      mockRanking(RANKING);
      mockResult(trpc.auth.me.useQuery, {
        data: undefined,
        isPending: true,
        isError: false,
      });
      renderDetail(<LeagueDetailPage />);

      expect(screen.getByRole("heading", { name: "Unirse" })).toBeInTheDocument();
      expect(screen.getByText("Consultando…")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Unirme a la liga" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("panel de administración (US-26, leagues.md §5)", () => {
    // Actor = admin (user-1), miembro piloto2 (user-2).
    const ADMIN_LEAGUE = {
      ...LEAGUE,
      members: [
        { userId: "user-1", username: "piloto1", role: "admin" },
        { userId: "user-2", username: "piloto2", role: "member" },
      ],
    };

    function mockMeAs(userId: string) {
      mockResult(trpc.auth.me.useQuery, {
        data: { id: userId, username: "yo", email: "yo@liga.com", roles: [] },
        isPending: false,
        isError: false,
      });
    }

    it("admin: muestra el formulario de configuración (nombre/descripción/visibilidad)", () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      renderDetail(<LeagueDetailPage />);

      expect(screen.getByRole("heading", { name: "Configuración" })).toBeInTheDocument();
      expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
      expect(screen.getByLabelText("Descripción")).toBeInTheDocument();
      expect(screen.getByLabelText("Visibilidad")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    });

    it("admin: muestra el ajuste de invitaciones de miembros", () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      renderDetail(<LeagueDetailPage />);

      expect(
        screen.getByLabelText(
          /Permitir que los miembros vean y compartan el código de invitación/,
        ),
      ).toBeInTheDocument();
    });

    it("admin: muestra el botón de cerrar la liga", () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      renderDetail(<LeagueDetailPage />);

      expect(screen.getByRole("button", { name: "Cerrar la liga" })).toBeInTheDocument();
    });

    it("admin: muestra 'Hacer admin' (solo no-admin) y 'Expulsar' para cada miembro ajeno", () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      renderDetail(<LeagueDetailPage />);

      // piloto2 (member, ajeno) → ambos botones.
      expect(screen.getByRole("button", { name: "Hacer admin" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Expulsar" })).toBeInTheDocument();
    });

    it("admin único: NO muestra 'Expulsar'/'Hacer admin' sobre su propia fila", () => {
      // El actor (user-1) es el único miembro: no hay ajenos a los que dirigir
      // acciones, así que no aparece ningún botón de gestión de miembros.
      mockLeague({
        ...ADMIN_LEAGUE,
        activeMembers: 1,
        members: [{ userId: "user-1", username: "piloto1", role: "admin" }],
      });
      mockRanking(RANKING);
      mockMeAs("user-1");
      renderDetail(<LeagueDetailPage />);

      expect(screen.queryByRole("button", { name: "Expulsar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Hacer admin" })).not.toBeInTheDocument();
    });

    it("miembro (no admin): no ve NINGÚN botón de gestión (US-26: solo el admin gestiona)", () => {
      mockLeague({ ...ADMIN_LEAGUE, isAdmin: false });
      mockRanking(RANKING);
      mockMeAs("user-2");
      renderDetail(<LeagueDetailPage />);

      expect(screen.queryByRole("heading", { name: "Administración" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Rotar código" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Hacer admin" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Expulsar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cerrar la liga" })).not.toBeInTheDocument();
    });

    it("clic en 'Hacer admin': envía leagueId + targetUserId", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      const mutate = mockMutation(trpc.leagues.transferAdmin.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Hacer admin" }));

      expect(mutate.mock.calls[0]?.[0]).toEqual({
        leagueId: "league-1",
        targetUserId: "user-2",
      });
    });

    it("clic en 'Expulsar': envía leagueId + targetUserId", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      const mutate = mockMutation(trpc.leagues.kick.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Expulsar" }));

      expect(mutate.mock.calls[0]?.[0]).toEqual({
        leagueId: "league-1",
        targetUserId: "user-2",
      });
    });

    it("clic en 'Cerrar la liga': envía la leagueId", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      const mutate = mockMutation(trpc.leagues.close.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Cerrar la liga" }));

      expect(mutate.mock.calls[0]?.[0]).toEqual({ leagueId: "league-1" });
    });

    it("cambiar el ajuste de invitaciones: envía leagueId + enabled", async () => {
      mockLeague({ ...ADMIN_LEAGUE, allowMemberInvites: false });
      mockRanking(RANKING);
      mockMeAs("user-1");
      const mutate = mockMutation(trpc.leagues.setMemberInvites.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.click(
        screen.getByLabelText(
          /Permitir que los miembros vean y compartan el código de invitación/,
        ),
      );

      expect(mutate.mock.calls[0]?.[0]).toEqual({
        leagueId: "league-1",
        enabled: true,
      });
    });

    it("guardar la configuración: envía los campos editados", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      const mutate = mockMutation(trpc.leagues.update.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.clear(screen.getByLabelText("Nombre"));
      await user.type(screen.getByLabelText("Nombre"), "Liga renombreada");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      expect(mutate.mock.calls[0]?.[0]).toEqual({
        leagueId: "league-1",
        name: "Liga renombreada",
        description: "Solo para la familia",
        visibility: "private",
      });
    });

    it("si una acción de gestión falla muestra el motivo del servidor (p. ej. 403)", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.kick.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Expulsar" }));

      await act(async () => {
        mutationOptions(trpc.leagues.kick.useMutation).onError?.(
          new Error("Solo el admin de la liga puede hacer esta acción."),
        );
      });

      expect(
        screen.getByText("Solo el admin de la liga puede hacer esta acción."),
      ).toBeInTheDocument();
    });

    it("editar descripción y visibilidad: envía los cambios", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      const mutate = mockMutation(trpc.leagues.update.useMutation);
      renderDetail(<LeagueDetailPage />);

      const user = userEvent.setup();
      await user.clear(screen.getByLabelText("Descripción"));
      await user.type(screen.getByLabelText("Descripción"), "Nueva descripción");
      await user.selectOptions(screen.getByLabelText("Visibilidad"), "unlisted");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      expect(mutate.mock.calls[0]?.[0]).toEqual({
        leagueId: "league-1",
        name: "Liga de los amigos",
        description: "Nueva descripción",
        visibility: "unlisted",
      });
    });

    it("update: éxito muestra 'Configuración guardada.'", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.update.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.update.useMutation).onSuccess?.();
      });
      expect(screen.getByText("Configuración guardada.")).toBeInTheDocument();
    });

    it("update: error muestra el motivo del servidor", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.update.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.update.useMutation).onError?.(
          new Error("Una liga privada no puede tener visibilidad pública."),
        );
      });
      expect(
        screen.getByText("Una liga privada no puede tener visibilidad pública."),
      ).toBeInTheDocument();
    });

    it("transferAdmin: éxito muestra 'Rol de admin transferido.'", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.transferAdmin.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.transferAdmin.useMutation).onSuccess?.();
      });
      expect(screen.getByText("Rol de admin transferido.")).toBeInTheDocument();
    });

    it("transferAdmin: error muestra el motivo del servidor", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.transferAdmin.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.transferAdmin.useMutation).onError?.(
          new Error("El destino debe ser un miembro activo de la liga."),
        );
      });
      expect(
        screen.getByText("El destino debe ser un miembro activo de la liga."),
      ).toBeInTheDocument();
    });

    it("kick: éxito muestra 'Miembro expulsado.'", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.kick.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.kick.useMutation).onSuccess?.();
      });
      expect(screen.getByText("Miembro expulsado.")).toBeInTheDocument();
    });

    it("close: éxito muestra 'Liga cerrada.'", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.close.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.close.useMutation).onSuccess?.();
      });
      expect(screen.getByText("Liga cerrada.")).toBeInTheDocument();
    });

    it("close: error muestra el motivo del servidor", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.close.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.close.useMutation).onError?.(
          new Error("La liga ya no está activa."),
        );
      });
      expect(screen.getByText("La liga ya no está activa.")).toBeInTheDocument();
    });

    it("setMemberInvites: éxito muestra 'Ajuste de invitaciones guardado.'", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.setMemberInvites.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.setMemberInvites.useMutation).onSuccess?.();
      });
      expect(
        screen.getByText("Ajuste de invitaciones guardado."),
      ).toBeInTheDocument();
    });

    it("setMemberInvites: error muestra el motivo del servidor", async () => {
      mockLeague(ADMIN_LEAGUE);
      mockRanking(RANKING);
      mockMeAs("user-1");
      mockMutation(trpc.leagues.setMemberInvites.useMutation);
      renderDetail(<LeagueDetailPage />);

      await act(async () => {
        mutationOptions(trpc.leagues.setMemberInvites.useMutation).onError?.(
          new Error("Solo el admin de la liga puede hacer esta acción."),
        );
      });
      expect(
        screen.getByText("Solo el admin de la liga puede hacer esta acción."),
      ).toBeInTheDocument();
    });
  });
});
