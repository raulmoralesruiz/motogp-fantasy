// @vitest-environment jsdom
/**
 * Tests de `app/registro/page.tsx` (T-24, fase C): página de registro con
 * el formulario (mockeado) y el enlace a login.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen } from "../../../test/rtl";

import RegisterPage from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

describe("RegisterPage", () => {
  beforeEach(() => {
    resetTrpcMocks();
    mockResult(trpc.auth.register.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
  });

  it("muestra el formulario y el enlace a login", () => {
    render(<RegisterPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Crea tu/);
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByLabelText("Nombre de usuario")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Acepto los términos y la política de privacidad"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
  });
});
