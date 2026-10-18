// @vitest-environment jsdom
/**
 * Tests de `app/login/page.tsx` (T-24, fase C): página de login con el
 * formulario (mockeado) y los enlaces a registro y recuperación.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen } from "../../../test/rtl";

import LoginPage from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

describe("LoginPage", () => {
  beforeEach(() => {
    resetTrpcMocks();
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
  });

  it("muestra el formulario y los enlaces a registro y recuperación", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Inicia/);
    expect(screen.getByRole("link", { name: "Regístrate" })).toHaveAttribute(
      "href",
      "/registro",
    );
    expect(
      screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" }),
    ).toHaveAttribute("href", "/recuperar-contrasena");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
  });
});
