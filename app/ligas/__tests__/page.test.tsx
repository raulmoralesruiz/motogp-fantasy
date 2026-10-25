// @vitest-environment jsdom
/**
 * Tests de `app/ligas/page.tsx` (US-23): wrapper de la página "Ligas"
 * (título + contenido sobre el `trpc` mockeado).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen } from "../../../test/rtl";

import LigasRoute from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

describe("LigasRoute (page.tsx)", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  it("muestra el título de la página", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <LigasRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ligas");
  });
});
