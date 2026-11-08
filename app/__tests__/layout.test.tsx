// @vitest-environment jsdom
/**
 * Tests de `app/layout.tsx` (T-24, fase C + T-26): layout raíz con el
 * proveedor tRPC (mockeado — el real se cubre en
 * `app/trpc/__tests__/client.test.tsx`) y la cabecera global (T-26)
 * montada en todas las páginas.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "../../test/rtl";
import { resetTrpcMocks } from "../../test/trpc-mock";
import { resetNavigationMocks } from "../../test/ui-mocks";

import RootLayout from "../layout";

vi.mock("@/trpc/client", () => import("../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../test/ui-mocks").then((m) => m.navigationMock),
);
vi.mock("next/link", () => import("../../test/ui-mocks").then((m) => m.linkMock));

/** El mock de `TRPCReactProvider` no aporta QueryClient: lo aportamos aquí. */
function renderLayout(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("RootLayout", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("renderiza los hijos dentro de <html lang=es> con el proveedor tRPC", () => {
    renderLayout(
      <RootLayout>
        <div>contenido</div>
      </RootLayout>,
    );
    expect(screen.getByText("contenido")).toBeInTheDocument();
    // jsdom hoistea el <html> renderizado al documento raíz.
    expect(document.documentElement.getAttribute("lang")).toBe("es");
  });

  it("T-26: monta la cabecera global (banner + nav «Secciones») en todas las páginas", () => {
    renderLayout(
      <RootLayout>
        <div>contenido</div>
      </RootLayout>,
    );
    // Landmark de cabecera (a11y) con la brand → home y la nav de secciones.
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Fantasy MotoGP/ }),
    ).toHaveAttribute("href", "/");
    expect(screen.getByRole("navigation", { name: "Secciones" })).toBeInTheDocument();
  });

  it("T-26: skip-link (WCAG 2.4.1) como primer enlace, con destino enfocable", () => {
    renderLayout(
      <RootLayout>
        <div>contenido</div>
      </RootLayout>,
    );
    // Primer elemento enfocable del documento (antes de la cabecera).
    const skip = screen.getByRole("link", { name: /Saltar al contenido/i });
    expect(skip).toHaveAttribute("href", "#contenido");
    expect(document.querySelector("a")).toBe(skip);
    // Destino existe y recibe el foco (patrón W3C: wrapper con tabindex -1).
    const target = document.getElementById("contenido");
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute("tabindex", "-1");
  });
});
