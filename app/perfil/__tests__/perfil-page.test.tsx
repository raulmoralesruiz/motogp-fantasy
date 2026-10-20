// @vitest-environment jsdom
/**
 * Tests de `app/perfil/perfil-page.tsx` (US-03): datos de la cuenta,
 * actualización del nombre visible, exportación JSON y eliminación de
 * cuenta sobre el `trpc` mockeado.
 */
import { getQueryKey } from "@trpc/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { navigation, resetNavigationMocks } from "../../../test/ui-mocks";
import { act, render, screen, userEvent } from "../../../test/rtl";

import PerfilPage from "../perfil-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

const ME = {
  email: "ana@liga.com",
  username: "ana_gp",
  displayName: "Ana GP",
  roles: ["user"],
  createdAt: new Date("2026-01-15T10:00:00Z"),
};

function renderPerfil(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

function mockMe() {
  mockResult(trpc.profile.me.useQuery, {
    data: ME,
    isPending: false,
    isError: false,
  });
}

function mutationOptions(hook: unknown): { onSuccess?: () => void } {
  return asMockFn(hook).mock.calls[0]?.[0] ?? {};
}

describe("PerfilPage", () => {
  beforeAll(() => {
    // jsdom no implementa la API de blobs: se sustituye para probar la
    // descarga JSON (US-03).
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
    vi.restoreAllMocks();
  });

  it("muestra el estado pendiente", () => {
    renderPerfil(<PerfilPage />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("sin sesión: enlaza al login", () => {
    mockResult(trpc.profile.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("sin sesión"),
    });
    renderPerfil(<PerfilPage />);
    expect(screen.getByText("Inicia sesión")).toBeInTheDocument();
  });

  it("muestra los datos de la cuenta", () => {
    mockMe();
    renderPerfil(<PerfilPage />);
    expect(screen.getByText("ana@liga.com")).toBeInTheDocument();
    expect(screen.getByText("ana_gp")).toBeInTheDocument();
    expect(screen.getByText("Ana GP")).toBeInTheDocument();
    // Fecha localizada (el formato exacto depende de la ICU del runtime).
    expect(
      screen.getByText(ME.createdAt.toLocaleDateString("es-ES")),
    ).toBeInTheDocument();
  });

  it("update: envía el nombre visible al guardar", async () => {
    mockMe();
    const mutate = vi.fn();
    mockResult(trpc.profile.update.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderPerfil(<PerfilPage />);

    const user = userEvent.setup();
    const input = screen.getByLabelText("Nombre visible");
    await user.clear(input);
    await user.type(input, "Ana MotoGP");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(mutate).toHaveBeenCalledWith({ displayName: "Ana MotoGP" });
  });

  it("update: tras el éxito invalida la consulta de la cuenta", async () => {
    mockMe();
    const mutate = vi.fn();
    mockResult(trpc.profile.update.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    const { queryClient } = renderPerfil(<PerfilPage />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    const input = screen.getByLabelText("Nombre visible");
    await user.clear(input);
    await user.type(input, "Ana MotoGP");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await act(async () => {
      mutationOptions(trpc.profile.update.useMutation).onSuccess?.();
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.profile.me),
    });
  });

  it("update: muestra el error de validación Zod por campo", () => {
    mockMe();
    const error = clientError("Invalid input", {
      zod: {
        issues: [
          {
            path: ["displayName"],
            message: "El nombre visible debe tener al menos 3 caracteres",
          },
        ],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.profile.update.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    renderPerfil(<PerfilPage />);
    expect(
      screen.getByText("El nombre visible debe tener al menos 3 caracteres"),
    ).toBeInTheDocument();
  });

  it("export: descarga un JSON con los datos del usuario", async () => {
    mockMe();
    const exportData = {
      cuenta: { ...ME, id: "id-1" },
      sesionesActivas: [],
      lineups: [],
      puntos: [],
      ligas: [],
    };
    mockResult(trpc.profile.export.useQuery, {
      data: exportData,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: exportData })),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    renderPerfil(<PerfilPage />);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Exportar mis datos (JSON)" }),
    );

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(screen.getByText(/Datos exportados/)).toBeInTheDocument();
    clickSpy.mockRestore();
  });

  it("export: muestra un error si la exportación falla", async () => {
    mockMe();
    mockResult(trpc.profile.export.useQuery, {
      data: undefined,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(async () => {
        throw new Error("fallo de red");
      }),
    });
    renderPerfil(<PerfilPage />);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Exportar mis datos (JSON)" }),
    );

    expect(
      screen.getByText("No se pudo exportar: fallo de red"),
    ).toBeInTheDocument();
  });

  it("delete: el botón está deshabilitado hasta marcar la confirmación", async () => {
    mockMe();
    mockResult(trpc.profile.delete.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    renderPerfil(<PerfilPage />);

    const button = screen.getByRole("button", { name: "Eliminar mi cuenta" });
    expect(button).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Entiendo que esta acción es irreversible/));
    expect(button).toBeEnabled();
  });

  it("delete: envía la contraseña al confirmar", async () => {
    mockMe();
    const mutate = vi.fn();
    mockResult(trpc.profile.delete.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderPerfil(<PerfilPage />);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Entiendo que esta acción es irreversible/));
    await user.type(screen.getByLabelText("Contraseña (confirmación)"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Eliminar mi cuenta" }));

    expect(mutate).toHaveBeenCalledWith({ password: "clave-secreta-1" });
  });

  it("delete: muestra el error general del servidor (p. ej. rate limit)", () => {
    mockMe();
    const error = clientError(
      "Demasiados intentos de eliminación. Inténtalo de nuevo en 3500 s.",
      { code: "TOO_MANY_REQUESTS" },
    );
    mockResult(trpc.profile.delete.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    renderPerfil(<PerfilPage />);
    expect(
      screen.getByText(/Demasiados intentos de eliminación/),
    ).toBeInTheDocument();
  });

  it("delete: tras el éxito limpia la caché de sesión y redirige a la home", async () => {
    mockMe();
    const mutate = vi.fn();
    mockResult(trpc.profile.delete.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderPerfil(<PerfilPage />);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Entiendo que esta acción es irreversible/));
    await user.type(screen.getByLabelText("Contraseña (confirmación)"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Eliminar mi cuenta" }));

    await act(async () => {
      mutationOptions(trpc.profile.delete.useMutation).onSuccess?.();
    });
    expect(navigation.push).toHaveBeenCalledWith("/");
  });
});
