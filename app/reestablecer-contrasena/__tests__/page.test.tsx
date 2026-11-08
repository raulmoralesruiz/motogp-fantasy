// @vitest-environment jsdom
/**
 * Tests de `app/reestablecer-contrasena/page.tsx` (T-24, fase C): página de
 * restablecimiento con Suspense (useSearchParams) y el formulario (mockeado).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { navigation, resetNavigationMocks } from "../../../test/ui-mocks";
import { render, screen } from "../../../test/rtl";

import ResetPasswordPage from "../page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
    mockResult(trpc.auth.resetPassword.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
  });

  it("muestra el formulario cuando el enlace tiene token", () => {
    navigation.searchParams = new URLSearchParams({ token: "tok-123" });
    render(<ResetPasswordPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Restablece tu/);
    expect(screen.getByLabelText("Nueva contraseña")).toBeInTheDocument();
    expect(screen.getByLabelText("Repite la contraseña")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restablecer contraseña" }),
    ).toBeInTheDocument();
    // F3 R4 P2: intro line + salida al login (consistencia con los demás
    // formularios de autenticación, que sí la tienen).
    expect(screen.getByText(/Establece una nueva contraseña/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a iniciar sesión" })).toHaveAttribute("href", "/login");
  });

  it("muestra el aviso cuando el enlace no tiene token", () => {
    render(<ResetPasswordPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/no es válido/);
  });
});
