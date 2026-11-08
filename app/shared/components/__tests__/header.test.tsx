// @vitest-environment jsdom
/**
 * Tests de la cabecera global (`app/shared/components/header.tsx`, T-26):
 * brand + secciones + sesión en todas las páginas, sección activa
 * (`aria-current`), estados de sesión (pendiente/anónimo/fallo real/
 * logueado), logout (éxito/fallo) y menú hamburguesa de móvil (Escape,
 * cierre al navegar y al cerrar sesión).
 *
 * Todo sobre el `trpc` mockeado; `usePathname` controlable vía `navigation`.
 */
import { getQueryKey } from "@trpc/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Header } from "../header";
import { asMockFn, mockResult, resetTrpcMocks, trpc } from "../../../../test/trpc-mock";
import { navigation, resetNavigationMocks } from "../../../../test/ui-mocks";
import { act, render, screen, userEvent } from "../../../../test/rtl";

vi.mock("@/trpc/client", () => import("../../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../../test/ui-mocks").then((m) => m.navigationMock),
);
vi.mock("next/link", () => import("../../../../test/ui-mocks").then((m) => m.linkMock));

let lastQueryClient: QueryClient | null = null;

function renderHeader() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  lastQueryClient = queryClient;
  return render(
    <QueryClientProvider client={queryClient}>
      <Header />
    </QueryClientProvider>,
  );
}

/** Error de `auth.me` sin sesión (UNAUTHORIZED, estado normal). */
const unauthorizedError = Object.assign(new Error("No estás autenticado"), {
  data: { code: "UNAUTHORIZED" },
});

const meLogged = {
  data: { username: "piloto1", email: "piloto@liga.com", roles: [] },
  isPending: false,
  isError: false,
};

describe("Header (T-26)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("renderiza brand → home y el landmark de nav con las 6 secciones", () => {
    renderHeader();
    expect(
      screen.getByRole("link", { name: /Fantasy MotoGP/ }),
    ).toHaveAttribute("href", "/");
    expect(screen.getByRole("navigation", { name: "Secciones" })).toBeInTheDocument();
    for (const [name, href] of [
      ["Lineups", "/lineups"],
      ["Mercado", "/mercado"],
      ["Puntuación", "/puntuacion"],
      ["Resultados", "/resultados"],
      ["Ligas", "/ligas"],
      ["Perfil", "/perfil"],
    ] as const) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("marca la sección activa con aria-current (a11y) y no la brand", () => {
    navigation.pathname = "/mercado";
    renderHeader();
    expect(screen.getByRole("link", { name: "Mercado" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Lineups" }),
    ).not.toHaveAttribute("aria-current");
    // La brand lleva a home pero no es ítem de nav: sin aria-current.
    expect(
      screen.getByRole("link", { name: /Fantasy MotoGP/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("solo muestra «Admin» en la nav para global_admin", () => {
    mockResult(trpc.auth.me.useQuery, {
      data: { username: "admin1", email: "admin@liga.com", roles: ["global_admin"] },
      isPending: false,
      isError: false,
    });
    renderHeader();
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute(
      "href",
      "/admin",
    );
  });

  it("no muestra «Admin» para un usuario sin rol global", () => {
    mockResult(trpc.auth.me.useQuery, meLogged);
    renderHeader();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("anónimo: ofrece «Iniciar sesión» + «Crear cuenta»", () => {
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: unauthorizedError,
    });
    renderHeader();
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute(
      "href",
      "/registro",
    );
    expect(
      screen.queryByRole("button", { name: "Cerrar sesión" }),
    ).not.toBeInTheDocument();
  });

  it("logueado: username + «Cerrar sesión»", () => {
    mockResult(trpc.auth.me.useQuery, meLogged);
    renderHeader();
    expect(screen.getByText("piloto1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Iniciar sesión" }),
    ).not.toBeInTheDocument();
  });

  it("pendiente: la zona de sesión queda vacía (no adivina)", () => {
    renderHeader(); // default del mock: query pendiente
    expect(
      screen.queryByRole("link", { name: "Iniciar sesión" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cerrar sesión" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No se pudo verificar la sesión"),
    ).not.toBeInTheDocument();
  });

  it("fallo real: aviso + «Reintentar», sin enmascarar como anónimo (F3 P3-1)", async () => {
    mockResult(trpc.auth.me.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("timeout de red"),
    });
    renderHeader();
    expect(screen.getByText("No se pudo verificar la sesión")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Iniciar sesión" }),
    ).not.toBeInTheDocument();
    // «Reintentar» re-ejecuta la consulta de `auth.me` (no navega a /login).
    const invalidate = vi.spyOn(lastQueryClient as QueryClient, "invalidateQueries");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Reintentar" }));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.auth.me),
    });
  });

  it("cierra la sesión al confirmarse y limpia el caché de `me`", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.me.useQuery, meLogged);
    mockResult(trpc.auth.logout.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderHeader();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(mutate).toHaveBeenCalledTimes(1);

    const options = asMockFn(trpc.auth.logout.useMutation).mock.calls[0]?.[0] as {
      onSuccess?: () => void;
    };
    const removeQueries = vi.spyOn(
      lastQueryClient as QueryClient,
      "removeQueries",
    );
    await act(async () => {
      expect(() => options.onSuccess?.()).not.toThrow();
    });
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: getQueryKey(trpc.auth.me),
    });
  });

  it("avisa si el logout falla y la sesión sigue viva (F3 P2)", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.me.useQuery, meLogged);
    mockResult(trpc.auth.logout.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    renderHeader();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Cerrar sesión" }));

    const options = asMockFn(trpc.auth.logout.useMutation).mock.calls[0]?.[0] as {
      onError?: (error: Error) => void;
    };
    await act(async () => {
      options.onError?.(new Error("fallo de red"));
    });
    expect(
      screen.getByText("No se pudo cerrar sesión: fallo de red"),
    ).toBeInTheDocument();
    // La sesión sigue viva: username y botón permanecen (reintentable).
    expect(screen.getByText("piloto1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  describe("menú hamburguesa (móvil)", () => {
    it("arranca cerrado: aria-expanded=false + aria-controls", () => {
      renderHeader();
      const btn = screen.getByRole("button", { name: "Abrir menú" });
      expect(btn).toHaveAttribute("aria-expanded", "false");
      expect(btn).toHaveAttribute("aria-controls", "site-header-menu");
    });

    it("abre al pulsar y cierra con Escape (el foco vuelve al toggle)", async () => {
      renderHeader();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Abrir menú" }));
      expect(
        screen.getByRole("button", { name: "Cerrar menú" }),
      ).toHaveAttribute("aria-expanded", "true");
      await user.keyboard("{Escape}");
      expect(
        screen.getByRole("button", { name: "Abrir menú" }),
      ).toHaveAttribute("aria-expanded", "false");
      // A11y (patrón disclosure): el foco no se pierde en <body>.
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Abrir menú" }),
      );
    });

    it("cierra al navegar (cambio de ruta; el foco vuelve al toggle)", async () => {
      renderHeader();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Abrir menú" }));
      expect(
        screen.getByRole("button", { name: "Cerrar menú" }),
      ).toBeInTheDocument();
      await act(async () => {
        navigation.pathname = "/mercado";
      });
      expect(
        screen.getByRole("button", { name: "Abrir menú" }),
      ).toHaveAttribute("aria-expanded", "false");
      // A11y (patrón disclosure): el foco no se pierde en <body>.
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Abrir menú" }),
      );
    });

    it("cierra al cerrar sesión (el foco vuelve al toggle)", async () => {
      const mutate = vi.fn();
      mockResult(trpc.auth.me.useQuery, meLogged);
      mockResult(trpc.auth.logout.useMutation, {
        mutate,
        isPending: false,
        isError: false,
      });
      renderHeader();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Abrir menú" }));
      await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
      const options = asMockFn(trpc.auth.logout.useMutation).mock.calls[0]?.[0] as {
        onSuccess?: () => void;
      };
      await act(async () => {
        options.onSuccess?.();
      });
      expect(
        screen.getByRole("button", { name: "Abrir menú" }),
      ).toHaveAttribute("aria-expanded", "false");
      // A11y (patrón disclosure): el foco no se pierde en <body>.
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Abrir menú" }),
      );
    });

    it("«Reintentar» se deshabilita durante el refetch (busy, anti doble clic)", () => {
      mockResult(trpc.auth.me.useQuery, {
        data: undefined,
        isPending: false,
        isError: true,
        error: new Error("timeout de red"),
        isRefetching: true,
      });
      renderHeader();
      expect(screen.getByText("No se pudo verificar la sesión")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeDisabled();
    });
  });
});
