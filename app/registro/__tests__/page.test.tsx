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
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByLabelText("Nombre de usuario")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Acepto los términos y la política de privacidad"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
  });

  it("explica al first-timer qué va a hacer aquí (F3 P2)", () => {
    render(<RegisterPage />);
    // La composición real del lineup (invariante 1) y el objetivo (compite
    // en ligas), no un «ligas de fantasy» genérico.
    expect(
      screen.getByText(/Monta tu lineup de 2 oro \+ 2 plata \+ 1 constructor \+ 1 equipo/),
    ).toBeInTheDocument();
    expect(screen.getByText(/compite cada GP en tus ligas/)).toBeInTheDocument();
  });
});
