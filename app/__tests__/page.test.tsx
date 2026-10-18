// @vitest-environment jsdom
/**
 * Tests de la home (`app/page.tsx`, T-24, fase C): estado del sistema
 * (health) y sesión (me/logout) sobre el `trpc` mockeado.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asMockFn, mockResult, resetTrpcMocks, trpc } from "../../test/trpc-mock";
import { navigation, resetNavigationMocks } from "../../test/ui-mocks";
import { act, render, screen, userEvent } from "../../test/rtl";

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
