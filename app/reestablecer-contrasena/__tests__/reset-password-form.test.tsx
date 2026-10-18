// @vitest-environment jsdom
/**
 * Tests de `app/reestablecer-contrasena/reset-password-form.tsx` (T-24,
 * fase C): token por query string, validación de coincidencia local,
 * envío y confirmación.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { navigation, resetNavigationMocks } from "../../../test/ui-mocks";
import { act, render, screen, userEvent } from "../../../test/rtl";

import ResetPasswordForm from "../reset-password-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

function resetOptions(): { onSuccess?: () => void } {
  return asMockFn(trpc.auth.resetPassword.useMutation).mock.calls[0]?.[0] ?? {};
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("rechaza el enlace sin token", () => {
    render(<ResetPasswordForm />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /El enlace de recuperación no es válido/,
    );
  });

  it("no envía si las contraseñas no coinciden", async () => {
    navigation.searchParams = new URLSearchParams({ token: "tok-123" });
    const mutate = vi.fn();
    mockResult(trpc.auth.resetPassword.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<ResetPasswordForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nueva contraseña"), "nueva-clave-1");
    await user.type(screen.getByLabelText("Repite la contraseña"), "otra-clave-2");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Las contraseñas no coinciden")).toBeInTheDocument();
  });

  it("envía token y contraseña cuando coinciden", async () => {
    navigation.searchParams = new URLSearchParams({ token: "tok-123" });
    const mutate = vi.fn();
    mockResult(trpc.auth.resetPassword.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<ResetPasswordForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nueva contraseña"), "nueva-clave-1");
    await user.type(screen.getByLabelText("Repite la contraseña"), "nueva-clave-1");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));

    expect(mutate).toHaveBeenCalledWith({
      token: "tok-123",
      password: "nueva-clave-1",
    });
  });

  it("confirma el restablecimiento y ofrece volver a login", async () => {
    navigation.searchParams = new URLSearchParams({ token: "tok-123" });
    const mutate = vi.fn();
    mockResult(trpc.auth.resetPassword.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<ResetPasswordForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nueva contraseña"), "nueva-clave-1");
    await user.type(screen.getByLabelText("Repite la contraseña"), "nueva-clave-1");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));

    await act(async () => {
      resetOptions().onSuccess?.();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Contraseña restablecida/);
    expect(screen.getByRole("link", { name: "Ir a iniciar sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("muestra el error de validación Zod por campo", () => {
    navigation.searchParams = new URLSearchParams({ token: "tok-123" });
    const error = clientError("Invalid input", {
      zod: {
        issues: [{ path: ["password"], message: "Mínimo 8 caracteres" }],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.auth.resetPassword.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<ResetPasswordForm />);
    expect(screen.getByText("Mínimo 8 caracteres")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    navigation.searchParams = new URLSearchParams({ token: "tok-123" });
    const error = clientError("Token inválido o expirado", {
      code: "UNAUTHORIZED",
      message: "Token inválido o expirado",
    });
    mockResult(trpc.auth.resetPassword.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<ResetPasswordForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("Token inválido o expirado");
  });

  it("desactiva el botón mientras carga", () => {
    navigation.searchParams = new URLSearchParams({ token: "tok-123" });
    const mutate = vi.fn();
    mockResult(trpc.auth.resetPassword.useMutation, {
      mutate,
      isPending: true,
      isError: false,
    });
    render(<ResetPasswordForm />);
    expect(screen.getByRole("button", { name: "Restableciendo…" })).toBeDisabled();
  });
});
