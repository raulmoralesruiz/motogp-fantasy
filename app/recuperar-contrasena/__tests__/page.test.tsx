// @vitest-environment jsdom
/**
 * Tests de `app/recuperar-contrasena/page.tsx` (T-24, fase C): página de
 * recuperación con el formulario (mockeado) y el enlace a login.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { render, screen } from "../../../test/rtl";

import RecoverPasswordPage from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

describe("RecoverPasswordPage", () => {
  beforeEach(() => {
    resetTrpcMocks();
    mockResult(trpc.auth.requestReset.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
  });

  it("muestra el formulario y el enlace a login", () => {
    render(<RecoverPasswordPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Recupera tu/);
    expect(screen.getByRole("link", { name: "Volver a iniciar sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enviar enlace de recuperación" }),
    ).toBeInTheDocument();
  });
});
