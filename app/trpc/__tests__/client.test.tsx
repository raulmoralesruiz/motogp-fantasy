// @vitest-environment jsdom
/**
 * Tests de `app/trpc/client.tsx` (T-24, fase C): el proveedor REAL de tRPC
 * + TanStack (sin mocks de `@/trpc/client` — es el módulo bajo test).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { act, render, screen } from "../../../test/rtl";
import { TRPCReactProvider, trpc } from "../client";

describe("TRPCReactProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renderiza los hijos dentro de los proveedores de tRPC y TanStack", () => {
    render(
      <TRPCReactProvider>
        <div>hijo</div>
      </TRPCReactProvider>,
    );
    expect(screen.getByText("hijo")).toBeInTheDocument();
  });

  it("registra en consola los errores de las operaciones en modo development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    // El `defaultLogger` de loggerLink enruta los errores a `console.error`.
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin red")));

    function Probe() {
      trpc.health.check.useQuery();
      return null;
    }

    render(
      <TRPCReactProvider>
        <Probe />
      </TRPCReactProvider>,
    );

    // Deja correr la query (rechazo de fetch) dentro de act.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(logSpy).toHaveBeenCalled();
  });
});
