// @vitest-environment jsdom
/**
 * Tests de `app/unirse/join-league-page.tsx` (US-25, leagues.md §4/§6,
 * ADR-0025):
 * - Sin sesión: enlace a /login (unirse exige cuenta — protectedProcedure).
 * - Con sesión: formulario de código de invitación.
 * - Envío: `leagues.join` con el código (trimado).
 * - Éxito: redirección al detalle de la liga.
 * - Error: el motivo del servidor en español (p. ej. "El código no es válido.").
 * - Botón desactivado sin código.
 *
 * Sobre el `trpc` mockeado (test/trpc-mock) y `next/navigation` mockeado
 * (test/ui-mocks: `useRouter` → `navigation.push`).
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { act, render, screen, userEvent } from "../../../test/rtl";
import { navigation, resetNavigationMocks } from "../../../test/ui-mocks";

import JoinLeaguePage from "../join-league-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

function renderJoin(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockMe(isError = false) {
  mockResult(trpc.auth.me.useQuery, {
    data: isError ? undefined : { username: "yo", email: "yo@liga.com", roles: [] },
    isPending: false,
    isError,
    error: isError ? new Error("No estás autenticado") : undefined,
  });
}

function mockJoinMutation() {
  const mutate = vi.fn();
  mockResult(trpc.leagues.join.useMutation, {
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
  onSuccess?: (result: unknown) => void;
  onError?: (err: Error) => void;
} {
  const calls = asMockFn(hook).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as {
    onSuccess?: (result: unknown) => void;
    onError?: (err: Error) => void;
  };
}

describe("JoinLeaguePage (US-25)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("muestra el estado pendiente de la sesión", () => {
    renderJoin(<JoinLeaguePage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("sin sesión: ofrece iniciar sesión o crear cuenta (unirse exige cuenta)", () => {
    mockMe(true);
    renderJoin(<JoinLeaguePage />);

    expect(
      screen.getByText(/Para unirte a una liga necesitas una cuenta/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "crea una cuenta" })).toHaveAttribute(
      "href",
      "/registro",
    );
    // Sin sesión no hay formulario.
    expect(screen.queryByRole("button", { name: "Unirme" })).not.toBeInTheDocument();
  });

  it("con sesión: muestra el formulario de código y el enlace de vuelta", () => {
    mockMe();
    renderJoin(<JoinLeaguePage />);

    expect(screen.getByLabelText("Código de invitación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unirme" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a ligas" })).toHaveAttribute(
      "href",
      "/ligas",
    );
  });

  it("desactiva el botón sin código", () => {
    mockMe();
    renderJoin(<JoinLeaguePage />);
    expect(screen.getByRole("button", { name: "Unirme" })).toBeDisabled();
  });

  it("envía el código (trimado) al enviar el formulario", async () => {
    mockMe();
    const mutate = mockJoinMutation();
    renderJoin(<JoinLeaguePage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Código de invitación"), "  ABC123XYZ9  ");
    await user.click(screen.getByRole("button", { name: "Unirme" }));

    expect(mutate.mock.calls[0]?.[0]).toEqual({ code: "ABC123XYZ9" });
  });

  it("tras el éxito redirige al detalle de la liga", async () => {
    mockMe();
    mockJoinMutation();
    renderJoin(<JoinLeaguePage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Código de invitación"), "ABC123XYZ9");
    await user.click(screen.getByRole("button", { name: "Unirme" }));

    await act(async () => {
      mutationOptions(trpc.leagues.join.useMutation).onSuccess?.({
        id: "league-42",
        name: "Liga de los amigos",
      });
    });

    expect(navigation.push).toHaveBeenCalledWith("/ligas/league-42");
  });

  it("si la unión falla muestra el motivo del servidor", async () => {
    mockMe();
    mockJoinMutation();
    renderJoin(<JoinLeaguePage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Código de invitación"), "MALCODIGO1");
    await user.click(screen.getByRole("button", { name: "Unirme" }));

    await act(async () => {
      mutationOptions(trpc.leagues.join.useMutation).onError?.(
        new Error("El código no es válido."),
      );
    });

    expect(screen.getByText("El código no es válido.")).toBeInTheDocument();
    // No redirige tras el fallo.
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("el fallo de bloqueo temporal muestra el motivo del servidor", async () => {
    mockMe();
    mockJoinMutation();
    renderJoin(<JoinLeaguePage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Código de invitación"), "MALCODIGO1");
    await user.click(screen.getByRole("button", { name: "Unirme" }));

    await act(async () => {
      mutationOptions(trpc.leagues.join.useMutation).onError?.(
        new Error("Demasiados intentos fallidos. Inténtalo de nuevo en 899 s."),
      );
    });

    expect(
      screen.getByText(/Demasiados intentos fallidos/),
    ).toBeInTheDocument();
  });
});
