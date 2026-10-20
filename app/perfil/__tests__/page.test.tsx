// @vitest-environment jsdom
/**
 * Tests de `app/perfil/page.tsx` (US-03): wrapper de la página de perfil
 * (título + contenido de la cuenta sobre el `trpc` mockeado).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen } from "../../../test/rtl";

import PerfilRoute from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

describe("PerfilRoute (page.tsx)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    mockResult(trpc.profile.me.useQuery, {
      data: {
        email: "ana@liga.com",
        username: "ana_gp",
        displayName: "Ana GP",
        roles: ["user"],
        createdAt: new Date("2026-01-15T10:00:00Z"),
      },
      isPending: false,
      isError: false,
    });
  });

  it("muestra el título y los datos de la cuenta", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PerfilRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Perfil");
    expect(
      screen.getByRole("heading", { level: 2, name: "Mis datos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ana@liga.com")).toBeInTheDocument();
    expect(screen.getByText("Ana GP")).toBeInTheDocument();
  });
});
