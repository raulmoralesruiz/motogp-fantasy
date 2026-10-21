// @vitest-environment jsdom
/**
 * Tests de `app/lineups/page.tsx` (US-09): wrapper de la página de lineups
 * (título + contenido del builder sobre el `trpc` mockeado).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen } from "../../../test/rtl";

import LineupsRoute from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

describe("LineupsRoute (page.tsx)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    // Temporadas cargadas (para que el wrapper muestre el selector).
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
        <LineupsRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lineups");
  });
});
