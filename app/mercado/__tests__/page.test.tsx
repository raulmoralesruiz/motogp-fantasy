// @vitest-environment jsdom
/**
 * Tests de `app/mercado/page.tsx` (US-14): wrapper de la página de mercado
 * (título + contenido del explorador sobre el `trpc` mockeado).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen } from "../../../test/rtl";

import MercadoRoute from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

describe("MercadoRoute (page.tsx)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    // Temporadas cargadas (el resto de hooks queda pendiente por defecto:
    // la página muestra el estado de carga sin errores).
    mockResult(trpc.seasons.list.useQuery, {
      data: [{ id: "s1", name: "Temporada 2099" }],
      isPending: false,
      isError: false,
    });
  });

  it("muestra el título de la página", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MercadoRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Mercado",
    );
  });
});
