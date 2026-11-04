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

type LoginData = { totpRequired?: boolean; totpToken?: string | null };
function loginOptions(): { onSuccess?: (data?: LoginData) => void } {
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

describe("LoginForm · segundo factor (D-07, ADR-0039)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("si el login devuelve un reto: pide el código y NO redirige", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    const verify = vi.fn();
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: verify,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });

    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Código de verificación")).toBeInTheDocument();
  });

  it("envía el código en verifyTotp y redirige al éxito", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    const verify = vi.fn();
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: verify,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Código de verificación"), "123456");
    await user.click(screen.getByRole("button", { name: "Verificar" }));

    expect(verify).toHaveBeenCalledWith({ token: "reto-123", code: "123456" });
    // El onSuccess es el del COMPONENTE (capturado por el mock).
    const verifyOptions: { onSuccess?: () => void } =
      asMockFn(trpc.auth.verifyTotp.useMutation).mock.calls[0]?.[0] ?? {};
    await act(async () => {
      verifyOptions.onSuccess?.();
    });
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("muestra el error del segundo factor (código inválido/caducado)", async () => {
    const error = clientError("El código no es válido o ha caducado.", {
      code: "UNAUTHORIZED",
      message: "El código no es válido o ha caducado.",
    });
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<LoginForm />);

    // Pasar al paso 2 (reto) antes de comprobar el error del paso 2.
    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    expect(
      screen.getByRole("alert").textContent,
    ).toContain("El código no es válido o ha caducado.");
  });
});
