// @vitest-environment jsdom
/**
 * Tests de `app/ligas/[id]/page.tsx` (US-24): wrapper de la página de
 * detalle de liga (título + contenido sobre el `trpc` mockeado).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetTrpcMocks } from "../../../../test/trpc-mock";
import { render, screen } from "../../../../test/rtl";
import { resetNavigationMocks } from "../../../../test/ui-mocks";

import LeagueDetailRoute from "../page";

vi.mock("@/trpc/client", () => import("../../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../../test/ui-mocks").then((m) => m.navigationMock),
);

describe("LeagueDetailRoute (page.tsx)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("muestra el título de la página", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <LeagueDetailRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Liga");
  });
});
