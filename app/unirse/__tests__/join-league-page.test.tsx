// @vitest-environment jsdom
/**
 * Tests de `app/unirse/join-league-page.tsx` (US-25, leagues.md §4/§6,
 * ADR-0025):
 * - Sin sesión: CTA de login con `next=/unirse` (conserva la puerta, F4 P2),
 *   "Crear cuenta" secundaria y salida al directorio público.
 * - Con sesión: formulario de código de invitación.
 * - Envío: `leagues.join` con el código (trimado).
 * - Éxito: momento marcado ("Te has unido a «…» — entrando…") + redirección
 *   diferida al detalle de la liga (F4 P1).
 * - Error: el motivo del servidor en español (p. ej. "El código no es
 *   válido."), junto a la acción (F4 P2); se limpia al nuevo intento (P3).
 * - CTA desactivado sin código, con motivo escrito (F4 P2).
 * - Fallo real de `auth.me` (no UNAUTHORIZED): no se lee como "sin cuenta"
 *   (F4 P3).
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
  // El error real de `auth.me` sin sesión es un TRPCClientError con
  // `data.code = "UNAUTHORIZED"` (la UI lo distingue de un fallo real — F4 P3).
  const error = isError
    ? Object.assign(new Error("No estás autenticado"), {
        data: { code: "UNAUTHORIZED" },
      })
    : undefined;
  mockResult(trpc.auth.me.useQuery, {
    data: isError ? undefined : { username: "yo", email: "yo@liga.com", roles: [] },
    isPending: false,
    isError,
    error,
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

  it("sin sesión: CTA de login con `next`, cuenta secundaria y salida al directorio", () => {
    mockMe(true);
    renderJoin(<JoinLeaguePage />);

    expect(
      screen.getByText(/Para unirte a una liga necesitas una cuenta/),
    ).toBeInTheDocument();
    // P2: la acción principal es un CTA (target ≥44 px) que conserva el
    // destino tras el login (`next=/unirse`).
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute(
      "href",
      "/login?next=/unirse",
    );
    expect(screen.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute(
      "href",
      "/registro",
    );
    // P2: la rama sin sesión también ofrece la salida "no tienes código".
    expect(screen.getByRole("link", { name: "Ver las ligas" })).toHaveAttribute(
      "href",
      "/ligas",
    );
    // Sin sesión no hay formulario de código.
    expect(screen.queryByRole("button", { name: "Unirme" })).not.toBeInTheDocument();
  });

  it("con sesión: muestra el formulario de código y la rama «no tienes código»", () => {
    mockMe();
    renderJoin(<JoinLeaguePage />);

    expect(screen.getByLabelText("Código de invitación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unirme" })).toBeInTheDocument();
    // P3: la intro ofrece la salida para quien no tiene código.
    expect(screen.getByRole("link", { name: "Ver las ligas" })).toHaveAttribute(
      "href",
      "/ligas",
    );
  });

  it("sin código: CTA bloqueado con motivo escrito (nunca un control muerto)", () => {
    mockMe();
    renderJoin(<JoinLeaguePage />);
    const button = screen.getByRole("button", { name: "Unirme" });
    // `aria-disabled` (no `disabled` nativo): sigue en el orden de foco y el
    // motivo se anuncia por `aria-describedby`.
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Escribe el código de invitación."),
    ).toBeInTheDocument();
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

  it("tras el éxito marca el momento y redirige al detalle de la liga", async () => {
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

    // P1: el pico del viaje se marca antes del redirect (peak-end).
    expect(
      screen.getByText(/Te has unido a «Liga de los amigos» — entrando…/),
    ).toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();

    // La redirección es diferida (~1 s).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1050));
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

  it("el error del servidor vive junto a la acción, dentro del formulario", async () => {
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

    const alert = screen.getByText("El código no es válido.");
    expect(alert.closest("form")).not.toBeNull();
  });

  it("limpia el error anterior al iniciar un nuevo intento", async () => {
    mockMe();
    mockJoinMutation();
    renderJoin(<JoinLeaguePage />);

    const user = userEvent.setup();
    const field = screen.getByLabelText("Código de invitación");
    await user.type(field, "MALCODIGO1");
    await user.click(screen.getByRole("button", { name: "Unirme" }));
    await act(async () => {
      mutationOptions(trpc.leagues.join.useMutation).onError?.(
        new Error("El código no es válido."),
      );
    });
    expect(screen.getByText("El código no es válido.")).toBeInTheDocument();

    await user.type(field, "2");
    await user.click(screen.getByRole("button", { name: "Unirme" }));

    // El residuo del intento anterior no sigue visible durante el envío.
    expect(screen.queryByText("El código no es válido.")).not.toBeInTheDocument();
  });

  it("un fallo real de auth.me (no UNAUTHORIZED) no se lee como «sin cuenta»", () => {
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("500 Internal Server Error"),
    });
    renderJoin(<JoinLeaguePage />);

    expect(
      screen.getByText(/No se pudo verificar tu sesión/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/necesitas una cuenta/)).not.toBeInTheDocument();
  });
});
