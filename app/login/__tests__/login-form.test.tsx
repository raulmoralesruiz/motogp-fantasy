// @vitest-environment jsdom
/**
 * Tests de `app/login/login-form.tsx` (T-24, fase C): envío de credenciales,
 * redirección, errores de validación Zod por campo y errores generales.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { navigation, resetNavigationMocks } from "../../../test/ui-mocks";
import { act, render, screen, userEvent } from "../../../test/rtl";

import LoginForm from "../login-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

function loginOptions(): { onSuccess?: () => void } {
  return asMockFn(trpc.auth.login.useMutation).mock.calls[0]?.[0] ?? {};
}

describe("LoginForm", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("envía email y contraseña al servidor", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.login.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(mutate).toHaveBeenCalledWith({
      email: "piloto@liga.com",
      password: "clave-secreta-1",
    });
  });

  it("redirige al inicio tras el login correcto", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.login.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await act(async () => {
      loginOptions().onSuccess?.();
    });
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: {
        issues: [{ path: ["email"], message: "El email no es válido" }],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<LoginForm />);
    expect(screen.getByText("El email no es válido")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Credenciales inválidas", {
      code: "UNAUTHORIZED",
      message: "Credenciales inválidas",
    });
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<LoginForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("Credenciales inválidas");
  });

  it("desactiva el botón mientras carga", () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.login.useMutation, {
      mutate,
      isPending: true,
      isError: false,
    });
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Iniciando sesión…" })).toBeDisabled();
  });
});
